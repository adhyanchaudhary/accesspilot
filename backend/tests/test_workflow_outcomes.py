import pytest
from backend.tests.test_job_sources import service, settings, submit


def report(client, payload, outcome, **kwargs):
    return client.post('/service/jobs/' + payload['job_id'] + '/outcome',
        headers={'Authorization': 'Bearer ' + payload['source_service']['credential']},
        json={'outcome': outcome}, **kwargs)


def test_zero_violations_skip_webhook(service):
    app, client, upstream = service
    async def clean(url):
        return {'violations': []}
    app.state.audit_queue.scanner = clean
    response = submit(client)
    assert response.status_code == 202
    assert not upstream.jobs
    result = client.get('/audits/' + response.json()['job_id']).json()
    assert result['status'] == 'completed'
    assert result['summary']['violation_count'] == 0
    assert result['remediation'] == {'status': 'no_changes', 'reason': 'no_violations'}


@pytest.mark.parametrize('outcome,status', [('no_candidate_files','no_changes'),
    ('no_changes','no_changes'), ('validation_failed','failed'), ('agent_failed','failed')])
def test_authenticated_outcome_is_visible_and_idempotent(service, outcome, status):
    app, client, upstream = service
    submit(client)
    payload = upstream.jobs[0]
    assert report(client, payload, outcome).status_code == 200
    assert report(client, payload, outcome).status_code == 200
    result = client.get('/audits/' + payload['job_id']).json()
    assert result['audit']['violations']
    assert result['remediation'] == {'status': status, 'reason': outcome}
    other = 'agent_failed' if outcome != 'agent_failed' else 'no_changes'
    assert report(client, payload, other).status_code == 409


def test_outcome_rejects_cookie_only_wrong_job_and_partial_writes(service):
    app, client, upstream = service
    submit(client); submit(client)
    first, second = upstream.jobs
    url = '/service/jobs/' + first['job_id'] + '/outcome'
    assert client.post(url,json={'outcome':'no_changes'}).status_code == 401
    assert client.post(url,json={'outcome':'no_changes'},headers={
        'Authorization':'Bearer '+second['source_service']['credential']}).status_code == 403
    app.state.jobs.get(first['job_id'])['remediation'] = {'pending':'commit'}
    assert report(client, first, 'no_changes').status_code == 409


def test_terminal_outcome_cannot_be_overwritten_by_remediation(service):
    app, client, upstream = service
    submit(client)
    payload = upstream.jobs[0]
    assert report(client,payload,'no_changes').status_code == 200
    response = client.post('/service/jobs/'+payload['job_id']+'/remediation',
        headers={'Authorization':'Bearer '+payload['source_service']['credential']},
        json={'changes':[{'file_path':'src/app.tsx','updated_code':'export const title = "fixed";'}]})
    assert response.status_code == 409
    assert client.get('/audits/'+payload['job_id']).json()['remediation']['status'] == 'no_changes'
