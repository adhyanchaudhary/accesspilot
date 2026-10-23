"""One bounded, job-scoped remediation commit and draft PR. No arbitrary GitHub API."""
import asyncio
import hashlib
import json
import re
import time
from pathlib import PurePosixPath
from urllib.parse import quote
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .change_previews import file_preview, bounded_previews, unavailable
from .github_auth import app_jwt
from .job_sources import pinned_tree, source_path, source_text, valid_sha

# Deliberately narrower than read access: existing frontend sources only.
WRITE_SUFFIXES = {'.html', '.htm', '.css', '.scss', '.sass', '.less', '.js', '.jsx',
                  '.ts', '.tsx', '.vue', '.svelte', '.astro'}
PROTECTED_DIRS = {'config', 'configs', 'scripts', 'infra', 'infrastructure', 'deploy',
                  'deployment', 'migrations', 'auth', 'authentication', 'security', 'api'}
ID = re.compile(r'^[a-zA-Z0-9_-]{1,80}$')


class FileChange(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    file_path: str = Field(min_length=1, max_length=1024)
    updated_code: str = Field(min_length=1, max_length=24576)
    issue_ids: list[str] = Field(default_factory=list, max_length=50)


class RemediationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    changes: list[FileChange] = Field(min_length=1, max_length=10)
    issue_ids: list[str] = Field(default_factory=list, max_length=50)
    unresolved_issues: list[str] = Field(default_factory=list, max_length=20)


def writable_path(path):
    name = PurePosixPath(path).name.lower()
    return (source_path(path) and PurePosixPath(path).suffix.lower() in WRITE_SUFFIXES
            and not any(part.lower() in PROTECTED_DIRS for part in path.split('/'))
            and 'config' not in name and not name.endswith('.d.ts')
            and PurePosixPath(name).stem not in {'auth', 'authentication', 'security', 'settings', 'middleware'}
            and name not in ('service-worker.js', 'sw.js'))


def text_allowed(text):
    if any(ord(c) < 32 and c not in '\t\n\r' or ord(c) == 127 for c in text):
        return False
    return not re.search(r'-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}', text)


def validate_input(body):
    paths = [change.file_path.casefold() for change in body.changes]
    if len(set(paths)) != len(paths):
        raise HTTPException(422, 'Duplicate file paths are not allowed')
    try:
        total = sum(len(change.updated_code.encode('utf-8')) for change in body.changes)
    except UnicodeError:
        raise HTTPException(422, 'Source must be valid UTF-8 text') from None
    if total > 24576:
        raise HTTPException(413, 'Combined source exceeds 24 KiB')
    for change in body.changes:
        if not writable_path(change.file_path) or not text_allowed(change.updated_code) or not change.updated_code.strip():
            raise HTTPException(422, 'Unsupported path or source content')
    if (any(not ID.fullmatch(value) for value in body.issue_ids)
            or any(not ID.fullmatch(value) for change in body.changes for value in change.issue_ids)
            or any(len(value) > 500 for value in body.unresolved_issues)):
        raise HTTPException(422, 'Invalid issue metadata')
    data = body.model_dump()
    data['changes'].sort(key=lambda item: item['file_path'])
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def owner_live(job, request):
    owner = request.app.state.sessions.get(job['owner_session'])
    if (not owner or owner['user']['id'] != job['owner_user_id'] or job['expires'] <= time.time()
            or job.get('status') not in ('dispatching', 'submitted')):
        raise HTTPException(403, 'Job authorization expired')
    return owner


async def remediate(body, request, access):
    job, github, read_token = access
    fingerprint = validate_input(body)
    lock = job.setdefault('remediation_lock', asyncio.Lock())
    async with lock:
        owner = owner_live(job, request)
        old = job.get('remediation')
        if old and old['fingerprint'] != fingerprint:
            raise HTTPException(409, 'This job already has a different remediation request')
        repo = job['repository']
        rid, installation_id = job['repository_id'], job['installation_id']
        if repo.get('id') != rid or repo.get('installation_id') != installation_id:
            raise HTTPException(403, 'Job repository metadata does not match its authorization')
        if old and old.get('result'):
            return old['result']
        root = f'/repositories/{rid}'
        current = await github.request('GET', root, owner['token'])
        if (current.get('id') != rid or current.get('full_name') != repo['full_name']
                or current.get('default_branch') != repo['default_branch']):
            raise HTTPException(409, 'Repository identity or default branch changed')
        if current.get('permissions', {}).get('push') is not True:
            raise HTTPException(403, 'The job owner does not have repository push permission')
        installation = await github.request('GET', f'/app/installations/{installation_id}', app_jwt(github.settings))
        required = {'contents': 'write', 'pull_requests': 'write'}
        if (installation.get('id') != installation_id or str(installation.get('app_id')) != github.settings.app_id
                or installation.get('suspended_at')
                or any(installation.get('permissions', {}).get(k) != v for k, v in required.items())):
            raise HTTPException(403, 'Installation does not grant the required write permissions')
        credential = await github.installation_token(installation_id, rid, write=True)
        if any(credential.get('permissions', {}).get(k) != v for k, v in required.items()):
            raise HTTPException(403, 'Installation token lacks required write permissions')
        token = credential['token']
        known_secrets = (request.headers.get('authorization', '').partition(' ')[2],
                         owner['token'], read_token, token, github.settings.client_secret,
                         github.settings.n8n_webhook_secret)
        if any(secret and len(secret) >= 8 and secret in change.updated_code
               for secret in known_secrets for change in body.changes):
            raise HTTPException(422, 'Proposed source contains a protected credential')
        base, tree = valid_sha(job['base_sha']), valid_sha(job['tree_sha'])
        commit = await github.request('GET', root + '/git/commits/' + base, read_token)
        if commit.get('sha') != base or commit.get('tree', {}).get('sha') != tree:
            raise HTTPException(409, 'Pinned commit and tree do not match')

        async def fresh_base():
            owner_live(job, request)
            ref = await github.request('GET', root + '/git/ref/heads/' + quote(repo['default_branch'], safe=''), token)
            if (ref.get('ref') != 'refs/heads/' + repo['default_branch']
                    or ref.get('object', {}).get('type') != 'commit'
                    or ref.get('object', {}).get('sha') != base):
                raise HTTPException(409, 'Default branch moved since this audit; run a fresh audit')

        await fresh_base()
        raw = await pinned_tree(github, job, read_token)
        if raw.get('sha') != tree:
            raise HTTPException(409, 'Pinned tree does not match')
        entries = {entry['path']: entry for entry in raw['tree'] if isinstance(entry, dict) and isinstance(entry.get('path'), str)}
        updates, previews = [], []
        for change in sorted(body.changes, key=lambda item: item.file_path):
            entry = entries.get(change.file_path)
            if (not entry or entry.get('type') != 'blob' or entry.get('mode') not in ('100644', '100755')
                    or type(entry.get('size')) is not int or not 0 <= entry['size'] <= 256 * 1024):
                raise HTTPException(422, 'File is not an allowed regular source file in the pinned tree')
            valid_sha(entry.get('sha'))
            original = await source_text(github, job, read_token, entry)
            if not text_allowed(original) or change.updated_code == original:
                raise HTTPException(422, 'Binary, protected or unchanged source cannot be remediated')
            ids = sorted(set(body.issue_ids + change.issue_ids))
            preview_secrets = (*known_secrets, github.settings.n8n_webhook_url, github.settings.private_key)
            protected = any(secret and len(secret) >= 8 and secret in value
                for secret in preview_secrets for value in [original, change.updated_code, change.file_path, *ids])
            if protected or any(not text_allowed(value) for value in ids):
                # Do not cache source/metadata that could contain a runtime credential.
                previews.append(unavailable('[protected file]', 'protected_content'))
            else:
                previews.append(file_preview(change.file_path, original, change.updated_code, ids))
            updates.append({'path': change.file_path, 'type': 'blob', 'mode': entry['mode'], 'content': change.updated_code})
        branch = 'accesspilot/remediation-' + str(UUID(job['id']))
        if branch == repo['default_branch']:
            raise HTTPException(409, 'Remediation branch cannot be the default branch')
        state = old or {'fingerprint': fingerprint, 'branch': branch, 'pending': None}
        state.setdefault('changes_preview', bounded_previews(previews))
        job['remediation'] = state
        ref_path = root + '/git/ref/heads/' + quote(branch, safe='')

        async def branch_ref():
            ref = await github.request('GET', ref_path, token, missing_ok=True)
            if ref is not None and (ref.get('ref') != 'refs/heads/' + branch
                    or ref.get('object', {}).get('type') != 'commit'):
                raise HTTPException(409, 'Unexpected remediation reference')
            return ref

        def result(pr):
            number = pr.get('number')
            expected = f"https://github.com/{repo['full_name']}/pull/{number}"
            if (type(number) is not int or number <= 0 or pr.get('html_url') != expected or pr.get('draft') is not True
                    or pr.get('head', {}).get('ref') != branch or pr.get('head', {}).get('sha') != state.get('commit_sha')
                    or pr.get('head', {}).get('repo', {}).get('id') != rid
                    or pr.get('base', {}).get('ref') != repo['default_branch']
                    or pr.get('base', {}).get('repo', {}).get('id') != rid):
                raise HTTPException(409, 'Existing PR does not match this job and commit')
            state['result'] = {'branch': branch, 'commit_sha': state['commit_sha'], 'pr_url': expected}
            state['pending'] = None
            return state['result']

        async def find_pr():
            prs = await github.request('GET', root + '/pulls', token, params={
                'state': 'all', 'head': repo['full_name'].split('/')[0] + ':' + branch,
                'base': repo['default_branch'], 'per_page': 100})
            if not isinstance(prs, list) or len(prs) >= 100:
                raise HTTPException(409, 'Cannot safely reconcile pull requests')
            if len(prs) > 1:
                raise HTTPException(409, 'Multiple pull requests exist for this job')
            return prs[0] if prs else None

        async def mutate(step, method, path, data):
            owner_live(job, request)
            state['pending'] = step  # retained on timeout/cancellation or unknown remote outcome
            try:
                response = await github.request(method, path, token, json=data, conflict_is_409=True)
            except HTTPException as error:
                if error.status_code in (401, 403, 409):
                    state['pending'] = None  # definite rejection: no write occurred
                raise
            return response

        pending = state['pending']
        if pending == 'pr':
            pr = await find_pr()
            if pr:
                return result(pr)
            raise HTTPException(409, 'PR creation outcome is unknown; reconcile before retrying')
        if pending in ('tree', 'commit'):
            raise HTTPException(409, 'Git object creation outcome is unknown; manual reconciliation required')
        if pending == 'branch':
            if await branch_ref() is not None:
                raise HTTPException(409, 'Branch creation outcome is unknown; manual reconciliation required')
            state['pending'] = None
        if not state.get('branch_created'):
            if await branch_ref() is not None:
                raise HTTPException(409, 'Remediation branch already exists; refusing to adopt it')
            await fresh_base()
            await mutate('branch', 'POST', root + '/git/refs', {'ref': 'refs/heads/' + branch, 'sha': base})
            state['branch_created'] = True
            state['pending'] = None
        ref = await branch_ref()
        head = ref.get('object', {}).get('sha') if ref else None
        if head not in (base, state.get('commit_sha')) or head is None:
            raise HTTPException(409, 'Remediation branch was changed externally')
        if not state.get('tree_sha'):
            created = await mutate('tree', 'POST', root + '/git/trees', {'base_tree': tree, 'tree': updates})
            state['tree_sha'] = valid_sha(created.get('sha'))
            state['pending'] = None
        if not state.get('commit_sha'):
            created = await mutate('commit', 'POST', root + '/git/commits', {
                'message': 'AccessPilot accessibility remediation ' + job['id'],
                'tree': state['tree_sha'], 'parents': [base]})
            new_sha = valid_sha(created.get('sha'))
            if (created.get('tree', {}).get('sha') != state['tree_sha']
                    or [parent.get('sha') for parent in created.get('parents', [])] != [base]):
                raise HTTPException(409, 'Created commit does not match the pinned base and tree')
            state['commit_sha'] = new_sha
            state['pending'] = None
        ref = await branch_ref()
        head = ref.get('object', {}).get('sha') if ref else None
        if head == base:
            await fresh_base()
            await mutate('update', 'PATCH', root + '/git/refs/heads/' + quote(branch, safe=''),
                         {'sha': state['commit_sha'], 'force': False})
        elif head != state['commit_sha']:
            raise HTTPException(409, 'Remediation branch SHA conflict')
        else:
            state['pending'] = None  # reconciled a previously ambiguous identical ref update
        ref = await branch_ref()
        if not ref or ref.get('object', {}).get('sha') != state['commit_sha']:
            raise HTTPException(409, 'Remediation branch did not reach the expected commit')
        state['pending'] = None
        await fresh_base()
        pr = await find_pr()
        if pr:
            return result(pr)
        pr = await mutate('pr', 'POST', root + '/pulls', {
            'title': 'AccessPilot accessibility fixes (' + job['id'][:8] + ')',
            'head': branch, 'base': repo['default_branch'], 'draft': True,
            'body': ('Automated accessibility remediation for AccessPilot job ' + job['id']
                     + '.\n\nPinned base: ' + base + '.\nChanged source files: ' + str(len(updates))
                     + '.\nUnresolved items reported: ' + str(len(body.unresolved_issues))
                     + '.\n\nDraft for human review.')})
        return result(pr)
