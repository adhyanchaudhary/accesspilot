import time

import pytest

from backend.change_previews import file_preview, bounded_previews, unavailable, blob_sha
from backend.tests.test_remediation import remediation, settings, BASE, COMMIT, ORIGINAL, BODY


def read(post, job):
    return post.client.get(f"/audits/{job['id']}/changes")


def test_confirmed_preview_matches_pinned_source_and_written_commit(remediation):
    _, job, github, post = remediation
    before = read(post, job)
    assert before.status_code == 200 and before.json()['status'] == 'pending'
    assert before.json()['files'] == []
    result = post()
    assert result.status_code == 200
    response = read(post, job)
    assert response.status_code == 200
    data = response.json()
    assert data['base_sha'] == BASE and data['commit_sha'] == COMMIT
    assert data['branch'] == result.json()['branch']
    file = data['files'][0]
    assert file['file_path'] == 'src/App.tsx' and file['issue_ids'] == ['image-alt']
    assert file['old_blob_sha'] == blob_sha(ORIGINAL.decode())
    assert file['new_blob_sha'] == blob_sha(BODY['changes'][0]['updated_code'])
    assert file['additions'] == file['deletions'] == 1
    assert file['hunks'][0]['lines'][0]['text'] == ORIGINAL.decode().rstrip('\n')
    assert file['hunks'][0]['lines'][1]['text'] == BODY['changes'][0]['updated_code'].rstrip('\n')
    assert file['hunks'][0]['lines'][0]['kind'] == 'delete'
    assert file['hunks'][0]['lines'][1]['kind'] == 'add'
    assert all(secret not in response.text for secret in ('read-secret','write-secret','user-secret', 'credential_hash','fingerprint','pending'))
    writes = len(github.writes())
    assert post().json() == result.json()
    assert read(post, job).json() == data and len(github.writes()) == writes
    assert response.headers['cache-control'] == 'no-store'


def test_failed_write_never_exposes_candidate_preview(remediation):
    _, job, github, post = remediation
    github.fail = ('POST', '/repositories/7/pulls')
    github.fail_status = 403
    assert post().status_code == 403
    assert job['remediation']['changes_preview']
    response = read(post, job)
    assert response.json() == {'job_id':job['id'], 'status':'unavailable','reason':'remediation_failed','files':[]}
    assert 'updated_code' not in response.text and 'export const' not in response.text
    assert post().status_code == 200
    assert read(post, job).json()['status'] == 'completed'


def test_preview_requires_browser_session_not_worker_bearer(remediation):
    _, job, _, post = remediation
    assert post().status_code == 200
    post.client.cookies.clear()
    assert post.client.get(f"/audits/{job['id']}/changes",headers={'Authorization':'Bearer any-job-credential'}).status_code == 401


@pytest.mark.parametrize('case, expected', [('other_user',404), ('expired_job',404), ('expired_session',401), ('revoked_installation',403), ('wrong_repo',403), ('wrong_installation',403), ('renamed_repo',403), ('wrong_job_id',404), ('owner_logged_out',403)])
def test_preview_authorization_fails_closed(remediation, case, expected):
    app, job, github, post = remediation
    assert post().status_code == 200
    if case == 'other_user':
        app.state.sessions.items['owner']['user']['id'] = 99
    elif case == 'expired_job': job['expires'] = time.time()-1
    elif case == 'expired_session': app.state.sessions.items['owner']['expires'] = time.time()-1
    elif case == 'revoked_installation': github.installed = False
    elif case == 'wrong_repo': job['repository']['id'] = 999
    elif case == 'wrong_installation': job['repository']['installation_id'] = 999
    elif case == 'renamed_repo': job['repository']['full_name'] = 'other/repo'
    elif case == 'wrong_job_id': job['id'] = 'other-job'
    else:
        app.state.sessions.put('new',dict(app.state.sessions.items['owner']))
        app.state.sessions.items.pop('owner')
        post.client.cookies.set('accesspilot_session','new')
    path_id = next(iter(app.state.jobs.items))
    assert post.client.get(f'/audits/{path_id}/changes').status_code == expected


def test_live_user_revocation_and_upstream_errors_are_sanitized(remediation):
    _, job, github, post = remediation
    assert post().status_code == 200
    github.fail = ('GET','/user/installations')
    github.fail_status = 403
    assert read(post, job).status_code == 403
    github.failed = False
    github.fail_status = 503
    response = read(post, job)
    assert response.status_code == 502 and 'PRIVATE-GITHUB-ERROR' not in response.text


def test_concurrent_logout_during_live_authorization_is_rejected(remediation, monkeypatch):
    app, job, _, post = remediation
    assert post().status_code == 200
    original = app.state.github.repository_access
    async def access(*args):
        result = await original(*args)
        app.state.sessions.items.pop('owner')
        return result
    monkeypatch.setattr(app.state.github,'repository_access',access)
    assert read(post, job).status_code == 403


def test_legacy_success_without_preview_is_honest(remediation):
    _, job, _, post = remediation
    assert post().status_code == 200
    job['remediation'].pop('changes_preview')
    assert read(post, job).json()['reason'] == 'preview_not_recorded'


def test_runtime_secret_in_original_is_not_exposed(remediation):
    _, job, github, post = remediation
    github.blob_data = b'const hidden = "user-secret";\n'
    entry = github.tree['tree'][0]
    entry['size'] = len(github.blob_data)
    entry['sha'] = blob_sha(github.blob_data.decode())
    assert post().status_code == 200
    response = read(post, job)
    assert response.json()['files'][0]['reason'] == 'protected_content'
    assert 'user-secret' not in response.text


def test_hunks_have_context_real_line_numbers_and_exact_counts():
    original = ''.join(f'line {n}\n' for n in range(30))
    updated = original.replace('line 2\n','changed\nextra\n').replace('line 25\n','')
    preview = file_preview('src/a.ts',original,updated,['image-alt','image-alt'])
    assert len(preview['hunks']) == 2
    assert preview['additions'] == 2 and preview['deletions'] == 2
    assert preview['issue_ids'] == ['image-alt']
    assert preview['hunks'][0]['lines'][0] == {'kind':'context','old_line':1,'new_line':1,'text':'line 0','ending':'lf'}
    assert preview['hunks'][1]['lines'][-1]['old_line'] == 29


def test_line_ending_and_final_newline_changes_are_not_lost():
    preview = file_preview('a.ts','old\r\nlast\n','old\nlast',[])
    lines = preview['hunks'][0]['lines']
    assert preview['additions'] == preview['deletions'] == 2
    assert lines[0]['ending'] == 'crlf' and lines[-1]['ending'] == 'none'
    assert lines[-1]['new_line'] == 2
    empty = file_preview('a.ts','','new\n',[])
    assert empty['hunks'][0]['old_start'] == 0 and empty['hunks'][0]['old_count'] == 0


@pytest.mark.parametrize('old', ['x\n'*2001, 'x'*70000])
def test_large_previews_are_withheld_without_fake_counts(old):
    result = file_preview('a.ts',old,'new\n',[])
    assert result == unavailable('a.ts','preview_limit')


def test_aggregate_budget_limits_response_size():
    files = [{'file_path':f'{i}.ts','padding':'x'*60000} for i in range(10)]
    previews = bounded_previews(files)
    assert previews[-1]['status'] == 'unavailable'


def test_configured_webhook_url_is_withheld_from_browser_preview(remediation):
    app, job, _, post = remediation
    body = {'changes': [{'file_path':'src/App.tsx',
        'updated_code':'const webhook = ' + repr(app.state.github.settings.n8n_webhook_url) + ';\n'}]}
    assert post(body).status_code == 200
    response = read(post, job)
    assert response.json()['files'][0]['reason'] == 'protected_content'
    assert app.state.github.settings.n8n_webhook_url not in response.text
    assert 'changes_preview' not in post.client.get(f"/audits/{job['id']}").text


def test_live_user_identity_mismatch_is_rejected(remediation, monkeypatch):
    app, job, _, post = remediation
    assert post().status_code == 200
    original = app.state.github.request
    async def changed_identity(method, path, token, **kwargs):
        if path == '/user': return {'id':999}
        return await original(method,path,token,**kwargs)
    monkeypatch.setattr(app.state.github,'request',changed_identity)
    assert read(post, job).status_code == 403
