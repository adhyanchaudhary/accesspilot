import base64
import copy
import hashlib
import json
import secrets
import time
from urllib.parse import unquote
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.tests.test_backend import settings

BASE, TREE, NEW_TREE, COMMIT = ('a'*40, 'b'*40, 'c'*40, 'd'*40)
ORIGINAL = b'export const App = () => <img src="hero.png"/>;\n'
BLOB = hashlib.sha1(f'blob {len(ORIGINAL)}\0'.encode() + ORIGINAL).hexdigest()
BODY = {'changes': [{'file_path': 'src/App.tsx',
    'updated_code': 'export const App = () => <img src="hero.png" alt="A garden"/>;\n',
    'issue_ids': ['image-alt']}], 'unresolved_issues': ['A manual keyboard check remains']}


class GitHubWriteMock:
    def __init__(self, job_id):
        self.branch = 'accesspilot/remediation-' + job_id
        self.refs = {'main': BASE}
        self.prs = []
        self.calls = []
        self.user_push = True
        self.permissions = {'contents': 'write', 'pull_requests': 'write'}
        self.token_permissions = dict(self.permissions)
        self.default_head = BASE
        self.tree = {'sha': TREE, 'truncated': False, 'tree': [
            {'path': 'src/App.tsx', 'mode': '100644', 'type': 'blob', 'size': len(ORIGINAL), 'sha': BLOB}]}
        self.fail = None
        self.failed = False
        self.lose_pr_response = False
        self.lose_commit_response = False
        self.lose_update_response = False
        self.branch_conflict = False
        self.tree_mismatch = False
        self.expected_files = 1
        self.blob_data = ORIGINAL
        self.malformed_commit = False
        self.advance_default_after_commit = False
        self.fail_status = 503
        self.installed = True

    def pr(self):
        return {'number': 1, 'html_url': 'https://github.com/alice/site/pull/1', 'draft': True,
                'head': {'ref': self.branch, 'sha': COMMIT, 'repo': {'id': 7}},
                'base': {'ref': 'main', 'repo': {'id': 7}}}

    def __call__(self, request):
        path, method = unquote(request.url.path), request.method
        data = json.loads(request.content) if request.content else None
        self.calls.append((method, path, data))
        if self.fail and (method, path) == self.fail and not self.failed:
            self.failed = True
            return httpx.Response(self.fail_status, json={'message': 'PRIVATE-GITHUB-ERROR'})
        if path == '/user':
            return httpx.Response(200, json={'id': 1, 'login': 'alice'})
        if path == '/user/installations':
            return httpx.Response(200, json={'installations': [{'id': 3, 'app_id': 42}]})
        if path == '/user/installations/3/repositories':
            return httpx.Response(200, json={'repositories': [{'id': 7, 'full_name': 'alice/site', 'private': True, 'default_branch': 'main'}]})
        if path == '/app/installations/3/access_tokens':
            assert data['repository_ids'] == [7]
            if data['permissions'] == {'contents': 'read'}:
                return httpx.Response(201, json={'token': 'read-secret'})
            assert data['permissions'] == {'contents': 'write', 'pull_requests': 'write'}
            return httpx.Response(201, json={'token': 'write-secret', 'permissions': self.token_permissions})
        if path == '/installation/repositories':
            return httpx.Response(200, json={'repositories': [{'id': 7}] if self.installed else []})
        if path == '/app/installations/3':
            return httpx.Response(200, json={'id': 3, 'app_id': 42, 'permissions': self.permissions})
        root = '/repositories/7'
        assert path.startswith(root), f'Unexpected repository access: {path}'
        tail = path[len(root):]
        if tail == '':
            return httpx.Response(200, json={'id': 7, 'full_name': 'alice/site',
                'default_branch': 'main', 'permissions': {'push': self.user_push}})
        if tail == '/git/commits/'+BASE:
            return httpx.Response(200, json={'sha': BASE, 'tree': {'sha': 'f'*40 if self.tree_mismatch else TREE}})
        if tail.startswith('/git/ref/heads/'):
            branch = tail[len('/git/ref/heads/'):]
            sha = self.default_head if branch == 'main' else self.refs.get(branch)
            if sha is None:
                return httpx.Response(404, json={})
            return httpx.Response(200, json={'ref': 'refs/heads/'+branch, 'object': {'sha': sha, 'type': 'commit'}})
        if tail == '/git/trees/'+TREE:
            return httpx.Response(200, json=self.tree)
        if tail.startswith('/git/blobs/'):
            return httpx.Response(200, json={'encoding': 'base64', 'size': len(self.blob_data),
                'content': base64.b64encode(self.blob_data).decode()})
        if tail == '/git/refs' and method == 'POST':
            assert data == {'ref': 'refs/heads/'+self.branch, 'sha': BASE}
            self.refs[self.branch] = BASE
            return httpx.Response(201, json={'ref': data['ref']})
        if tail == '/git/trees' and method == 'POST':
            assert data['base_tree'] == TREE and len(data['tree']) == self.expected_files
            assert data['tree'][0]['mode'] == '100644'
            return httpx.Response(201, json={'sha': NEW_TREE})
        if tail == '/git/commits' and method == 'POST':
            assert data['parents'] == [BASE] and data['tree'] == NEW_TREE
            if self.lose_commit_response:
                raise httpx.ReadTimeout('PRIVATE-GITHUB-ERROR', request=request)
            if self.advance_default_after_commit:
                self.default_head = 'f'*40
            return httpx.Response(201, json={'sha': 'malformed' if self.malformed_commit else COMMIT, 'tree': {'sha': NEW_TREE}, 'parents': [{'sha': BASE}]})
        if tail == '/git/refs/heads/'+self.branch and method == 'PATCH':
            assert data == {'sha': COMMIT, 'force': False}
            if self.branch_conflict:
                self.refs[self.branch] = 'f'*40
                return httpx.Response(422, json={})
            self.refs[self.branch] = COMMIT
            if self.lose_update_response:
                self.lose_update_response = False
                raise httpx.ReadTimeout('PRIVATE-GITHUB-ERROR', request=request)
            return httpx.Response(200, json={'object': {'sha': COMMIT}})
        if tail == '/pulls' and method == 'GET':
            assert request.url.params['head'] == 'alice:'+self.branch
            assert request.url.params['base'] == 'main' and request.url.params['state'] == 'all'
            return httpx.Response(200, json=self.prs)
        if tail == '/pulls' and method == 'POST':
            assert data['draft'] is True and data['head'] == self.branch and data['base'] == 'main'
            assert 'manual keyboard' not in data['body']  # no untrusted issue descriptions in PR body
            assert 'secret' not in json.dumps(data)
            self.prs.append(self.pr())
            if self.lose_pr_response:
                self.lose_pr_response = False
                raise httpx.ReadTimeout('PRIVATE-GITHUB-ERROR', request=request)
            return httpx.Response(201, json=self.prs[-1])
        raise AssertionError(f'Unexpected call {method} {path}')

    def writes(self, suffix=None):
        return [(m, p, b) for m, p, b in self.calls if m in ('POST', 'PATCH')
            and '/repositories/' in p and (suffix is None or p.endswith(suffix))]


@pytest.fixture
def remediation(settings):
    job_id, credential = str(uuid4()), secrets.token_urlsafe(32)
    upstream = GitHubWriteMock(job_id)
    app = create_app(settings, httpx.MockTransport(upstream))
    with TestClient(app) as client:
        app.state.sessions.put('owner', {'token': 'user-secret', 'csrf': 'csrf',
            'user': {'id': 1}, 'expires': time.time()+300})
        job = {'id': job_id, 'repository_id': 7, 'installation_id': 3,
            'repository': {'id': 7, 'installation_id': 3, 'full_name': 'alice/site', 'default_branch': 'main'},
            'owner_session': 'owner', 'owner_user_id': 1, 'status': 'submitted',
            'credential_hash': hashlib.sha256(credential.encode()).hexdigest(),
            'expires': time.time()+300, 'base_sha': BASE, 'tree_sha': TREE}
        app.state.jobs.put(job_id, job)
        client.cookies.set('accesspilot_session', 'owner')
        def post(body=None, auth=True):
            return client.post(f'/service/jobs/{job_id}/remediation', json=BODY if body is None else body,
                headers={'Authorization': 'Bearer '+credential} if auth else {})
        post.client = client
        yield app, job, upstream, post


def test_success_one_commit_draft_pr_and_cached_retry(remediation):
    _, _, github, post = remediation
    first = post()
    assert first.status_code == 200, first.text
    assert first.json() == {'branch': github.branch, 'commit_sha': COMMIT,
        'pr_url': 'https://github.com/alice/site/pull/1'}
    assert len(github.writes('/git/commits')) == 1 and len(github.writes('/git/trees')) == 1
    assert len(github.prs) == 1 and github.refs['main'] == BASE
    count = len(github.writes())
    assert post().json() == first.json() and len(github.writes()) == count
    changed = copy.deepcopy(BODY)
    changed['changes'][0]['updated_code'] += '// another fix'
    assert post(changed).status_code == 409
    assert all(value not in first.text for value in ('read-secret', 'write-secret', 'user-secret'))


@pytest.mark.parametrize('case', ['duplicate', 'traversal', 'config', 'new_file', 'binary', 'empty',
    'unchanged', 'repository_override', 'installation_override', 'token_override', 'oversize', 'symlink', 'base_tree_mismatch'])
def test_input_and_pinned_tree_validation_fail_before_writes(remediation, case):
    _, _, github, post = remediation
    body = copy.deepcopy(BODY)
    if case == 'duplicate':
        body['changes'] *= 2
    elif case in ('traversal', 'config', 'new_file'):
        body['changes'][0]['file_path'] = {'traversal': '../src/App.tsx', 'config': 'vite.config.ts', 'new_file': 'src/new.tsx'}[case]
    elif case == 'binary':
        body['changes'][0]['updated_code'] = '\x00hello'
    elif case == 'empty':
        body['changes'] = []
    elif case == 'unchanged':
        body['changes'][0]['updated_code'] = ORIGINAL.decode()
    elif case.endswith('_override'):
        body[case.removesuffix('_override')] = 'attacker-input'
    elif case == 'oversize':
        body['changes'][0]['updated_code'] = 'x'*30000
    elif case == 'symlink':
        github.tree['tree'][0]['mode'] = '120000'
    else:
        github.tree_mismatch = True
    assert post(body).status_code in (409, 413, 422)
    assert not github.writes()


@pytest.mark.parametrize('case', ['cookie_only', 'job_status', 'job_mismatch', 'repo_mismatch', 'installation_mismatch',
    'read_only_user', 'app_permission', 'token_permission', 'revoked_installation', 'expired_owner'])
def test_auth_and_permissions_fail_before_writes(remediation, case):
    app, job, github, post = remediation
    if case == 'cookie_only':
        assert post(auth=False).status_code == 401
        return
    if case == 'job_status':
        job['status'] = 'scanning'
    elif case == 'job_mismatch':
        job['id'] = str(uuid4())
    elif case == 'repo_mismatch':
        job['repository']['id'] = 99
    elif case == 'installation_mismatch':
        job['repository']['installation_id'] = 99
    elif case == 'read_only_user':
        github.user_push = False
    elif case == 'app_permission':
        github.permissions['contents'] = 'read'
    elif case == 'token_permission':
        github.token_permissions['pull_requests'] = 'read'
    elif case == 'revoked_installation':
        github.installed = False
    else:
        app.state.sessions.items.clear()
    assert post().status_code == 403
    assert not github.writes()


def test_stale_default_and_sha_conflicts(remediation):
    _, _, github, post = remediation
    github.default_head = 'f'*40
    assert post().status_code == 409 and not github.writes()
    github.default_head = BASE
    github.branch_conflict = True
    assert post().status_code == 409
    assert not github.prs
    assert github.refs['main'] == BASE


def test_preexisting_branch_is_not_adopted(remediation):
    _, _, github, post = remediation
    github.refs[github.branch] = BASE
    assert post().status_code == 409
    assert not github.writes()


@pytest.mark.parametrize('failure', ['pr_response', 'update_response', 'commit_response', 'tree_api', 'pr_api'])
def test_retry_reconciliation_and_ambiguous_fail_closed(remediation, failure):
    _, _, github, post = remediation
    if failure == 'pr_response':
        github.lose_pr_response = True
    elif failure == 'update_response':
        github.lose_update_response = True
    elif failure == 'commit_response':
        github.lose_commit_response = True
    else:
        github.fail = ('POST', '/repositories/7/git/trees' if failure == 'tree_api' else '/repositories/7/pulls')
    first = post()
    assert first.status_code == 502, first.text
    assert 'PRIVATE-GITHUB-ERROR' not in first.text
    retry = post()
    if failure in ('commit_response', 'tree_api', 'pr_api'):
        assert retry.status_code == 409
    else:
        assert retry.status_code == 200, retry.text
        assert len(github.prs) == 1
    assert len(github.writes('/git/commits')) <= 1
    assert len(github.writes('/pulls')) <= 1
    assert github.refs['main'] == BASE


def test_multiple_files_single_tree_and_commit_preserve_modes(remediation):
    _, _, github, post = remediation
    github.expected_files = 2
    github.tree['tree'].append({'path': 'src/Other.tsx', 'mode': '100755', 'type': 'blob', 'sha': BLOB, 'size': len(ORIGINAL)})
    body = copy.deepcopy(BODY)
    body['changes'].append({'file_path': 'src/Other.tsx', 'updated_code': 'export const Other = () => <button>Save</button>;\n'})
    assert post(body).status_code == 200
    updates = github.writes('/git/trees')[0][2]['tree']
    assert len(updates) == 2 and updates[1]['mode'] == '100755'
    assert len(github.writes('/git/commits')) == 1 and len(github.prs) == 1


def test_cross_job_credential_cannot_authorize_remediation(remediation):
    app, job, github, post = remediation
    other = dict(job, id=str(uuid4()), credential_hash=hashlib.sha256(b'other-job-credential').hexdigest())
    app.state.jobs.put(other['id'], other)
    response = post.client.post(f"/service/jobs/{job['id']}/remediation", json=BODY,
        headers={'Authorization': 'Bearer other-job-credential'})
    assert response.status_code == 403 and not github.writes()


def test_binary_original_is_rejected_before_writes(remediation):
    _, _, github, post = remediation
    github.blob_data = b'\0' * len(ORIGINAL)
    github.tree['tree'][0]['sha'] = hashlib.sha1(f'blob {len(ORIGINAL)}\0'.encode()+github.blob_data).hexdigest()
    assert post().status_code == 422 and not github.writes()


def test_base_moves_during_git_object_creation(remediation):
    _, _, github, post = remediation
    github.advance_default_after_commit = True
    assert post().status_code == 409
    assert not github.prs
    assert not any(method == 'PATCH' for method, _, _ in github.writes())


def test_malformed_commit_response_does_not_create_second_commit(remediation):
    _, _, github, post = remediation
    github.malformed_commit = True
    assert post().status_code == 502
    assert post().status_code == 409
    assert len(github.writes('/git/commits')) == 1


def test_concurrent_retries_only_create_one_commit_and_pr(remediation):
    from concurrent.futures import ThreadPoolExecutor
    _, _, github, post = remediation
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(post) for _ in range(2)]
        responses = [future.result() for future in futures]
    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    assert len(github.writes('/git/commits')) == 1 and len(github.prs) == 1


def test_definite_pr_denial_can_be_retried_without_new_commit(remediation):
    _, _, github, post = remediation
    github.fail = ('POST', '/repositories/7/pulls')
    github.fail_status = 403
    assert post().status_code == 403
    assert post().status_code == 200
    assert len(github.writes('/git/commits')) == 1 and len(github.prs) == 1


def test_known_credential_cannot_be_written_to_source(remediation):
    _, _, github, post = remediation
    body = copy.deepcopy(BODY)
    body['changes'][0]['updated_code'] = 'const token = "write-secret";'
    assert post(body).status_code == 422 and not github.writes()
