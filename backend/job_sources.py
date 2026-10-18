"""Read-only, immutable repository snapshots for authenticated job workers."""
import base64
import binascii
import hashlib
import re
import secrets
import time
from pathlib import PurePosixPath
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

MAX_FILE_BYTES = 256 * 1024
MAX_TREE_ENTRIES = 10000
SOURCE_SUFFIXES = {'.html', '.htm', '.css', '.scss', '.sass', '.less', '.js', '.jsx',
                   '.ts', '.tsx', '.vue', '.svelte', '.astro', '.py', '.rb', '.php',
                   '.go', '.java', '.kt', '.rs', '.cs', '.md', '.mdx', '.json'}
EXCLUDED_PARTS = {'node_modules', 'vendor', 'dist', 'build', 'coverage', '__pycache__',
                  'secrets', 'credentials', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'}
SHA = re.compile(r'^[0-9a-f]{40}$')


def source_path(path):
    if not path or len(path) > 1024 or '\\' in path or any(ord(c) < 32 for c in path):
        return False
    parts = path.split('/')
    if any(not p or p.startswith('.') or p.lower() in EXCLUDED_PARTS for p in parts):
        return False
    name = parts[-1].lower()
    if any(word in name for word in ('secret', 'credential', 'private_key', 'private-key')):
        return False
    return PurePosixPath(path).suffix.lower() in SOURCE_SUFFIXES


def valid_sha(value):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise HTTPException(502, 'GitHub returned an invalid object identifier')
    return value


async def snapshot(github, repo, token):
    data = await github.request('GET',
        f"/repositories/{repo['id']}/commits/{quote(repo['default_branch'], safe='')}", token)
    try:
        return {'base_sha': valid_sha(data['sha']),
                'tree_sha': valid_sha(data['commit']['tree']['sha'])}
    except (KeyError, TypeError):
        raise HTTPException(502, 'GitHub returned an invalid commit') from None


async def source_tree(github, job, token):
    data = await github.request('GET',
        f"/repositories/{job['repository_id']}/git/trees/{job['tree_sha']}", token,
        params={'recursive': '1'})
    if data.get('truncated') is not False or not isinstance(data.get('tree'), list):
        raise HTTPException(413, 'Repository tree is incomplete or too large')
    if len(data['tree']) > MAX_TREE_ENTRIES:
        raise HTTPException(413, 'Repository tree exceeds the entry limit')
    result = []
    for entry in data['tree']:
        path = entry.get('path', '')
        if (entry.get('type') == 'blob' and entry.get('mode') in ('100644', '100755')
                and isinstance(path, str) and source_path(path)
                and isinstance(entry.get('size'), int) and 0 <= entry['size'] <= MAX_FILE_BYTES):
            result.append({'path': path, 'sha': valid_sha(entry.get('sha')), 'size': entry['size']})
    return result


def source_router():
    router = APIRouter(prefix='/service/jobs', tags=['Job source service'])
    bearer = HTTPBearer(auto_error=False)

    async def authorized_job(job_id: str, request: Request,
            credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        # Browser cookies are never accepted as worker authentication.
        if credentials is None or credentials.scheme.lower() != 'bearer':
            raise HTTPException(401, 'Job service credential required', headers={'WWW-Authenticate': 'Bearer'})
        job = request.app.state.jobs.get(job_id)
        supplied = hashlib.sha256(credentials.credentials.encode()).hexdigest()
        if (not job or job.get('status') not in ('dispatching', 'submitted')
                or not secrets.compare_digest(job['credential_hash'], supplied)):
            raise HTTPException(403, 'Job service access denied')
        owner = request.app.state.sessions.get(job['owner_session'])
        if not owner or owner['user']['id'] != job['owner_user_id']:
            raise HTTPException(403, 'Job owner session is no longer authorized')
        github = request.app.state.github
        user = await github.request('GET', '/user', owner['token'])
        if user.get('id') != job['owner_user_id']:
            raise HTTPException(403, 'Job owner identity does not match')
        _, token = await github.repository_access(owner['token'], job['installation_id'], job['repository_id'])
        # Recheck local expiry after network awaits, including concurrent logout.
        if (job['expires'] <= time.time()
                or request.app.state.sessions.get(job['owner_session']) is not owner):
            raise HTTPException(403, 'Job authorization expired')
        return job, github, token

    @router.get('/{job_id}/tree')
    async def tree(access=Depends(authorized_job)):
        job, github, token = access
        return {'job_id': job['id'], 'base_sha': job['base_sha'],
                'files': await source_tree(github, job, token)}

    @router.get('/{job_id}/source')
    async def source(path: str = Query(min_length=1, max_length=1024), access=Depends(authorized_job)):
        job, github, token = access
        if not source_path(path):
            raise HTTPException(403, 'Path is outside the source policy')
        files = await source_tree(github, job, token)
        entry = next((entry for entry in files if entry['path'] == path), None)
        if entry is None:
            raise HTTPException(404, 'Source file not found in the job snapshot')
        # Fetch only a blob proven to be present in this job's immutable tree.
        data = await github.request('GET',
            f"/repositories/{job['repository_id']}/git/blobs/{entry['sha']}", token)
        try:
            encoded = data['content']
            if (data.get('encoding') != 'base64' or data.get('size') != entry['size']
                    or not isinstance(encoded, str) or len(encoded) > MAX_FILE_BYTES * 2):
                raise ValueError()
            content = base64.b64decode(encoded.replace('\n', ''), validate=True)
            if len(content) != entry['size'] or b'\x00' in content:
                raise ValueError()
            digest = hashlib.sha1(f'blob {len(content)}\0'.encode() + content).hexdigest()
            if digest != entry['sha']:
                raise ValueError()
            text = content.decode('utf-8')
            if re.search(r'-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----', text):
                raise ValueError()
        except (KeyError, ValueError, UnicodeError, binascii.Error):
            raise HTTPException(422, 'Blob is not valid, bounded UTF-8 source text') from None
        return {'job_id': job['id'], 'base_sha': job['base_sha'], 'path': path,
                'blob_sha': entry['sha'], 'text': text}

    return router
