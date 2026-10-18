"""Single-process bounded async audit queue. No automatic scan/delivery retries."""
import asyncio
import hashlib
import json
import secrets
import time
from uuid import uuid4

from fastapi import HTTPException

from .audit_scans import ScannerRunner, ScanFailure, normalize_audit, SCAN_TIMEOUT
from .security import bounded_request


class AuditQueue:
    def __init__(self, app, settings, scanner=None):
        self.app, self.settings = app, settings
        self.scanner = scanner or ScannerRunner()
        self.queue = asyncio.Queue(maxsize=settings.scan_queue_size)
        self.keys = {}
        self.workers = []

    async def start(self):
        self.workers = [asyncio.create_task(self.worker()) for _ in range(self.settings.scan_concurrency)]

    async def stop(self):
        for task in self.workers:
            task.cancel()
        await asyncio.gather(*self.workers, return_exceptions=True)
        for job in self.app.state.jobs.items.values():
            if job.get('status') in ('queued', 'scanning', 'dispatching'):
                self.fail(job, 'backend_stopped')

    def enqueue(self, body, repo, pinned, owner_session, owner, key):
        fingerprint = hashlib.sha256(json.dumps(body.model_dump(), sort_keys=True).encode()).hexdigest()
        cache_key = (owner_session, key or fingerprint)
        # Bounded by the same expiring job store; never keep request bodies/secrets in this index.
        for existing_key, entry in list(self.keys.items()):
            if not self.app.state.jobs.get(entry['job_id']):
                del self.keys[existing_key]
        old = self.keys.get(cache_key)
        if old:
            if old['fingerprint'] != fingerprint:
                raise HTTPException(409, 'Idempotency key was already used with different input')
            job = self.app.state.jobs.get(old['job_id'])
            return job
        if self.queue.full():
            raise HTTPException(503, 'Scan queue is full; try later')
        job_id = str(uuid4())
        job = {'id': job_id, 'repository_id': repo['id'], 'installation_id': repo['installation_id'],
               'repository': repo, 'website_url': body.website_url,
               'owner_session': owner_session, 'owner_user_id': owner['user']['id'],
               'expires': min(owner['expires'], time.time() + 3600),
               'credential_hash': '', 'status': 'queued', 'error': None, **pinned}
        self.app.state.jobs.put(job_id, job)
        self.keys[cache_key] = {'job_id': job_id, 'fingerprint': fingerprint}
        self.queue.put_nowait(job_id)  # no await between reservation and insertion
        return job

    def fail(self, job, error):
        job.update(status='failed', error=error, credential_hash='')

    async def authorize(self, job):
        owner = self.app.state.sessions.get(job['owner_session'])
        if (job['expires'] <= time.time() or not owner or owner['user']['id'] != job['owner_user_id']):
            raise ScanFailure('authorization_expired')
        github = self.app.state.github
        user = await github.request('GET', '/user', owner['token'])
        if user.get('id') != job['owner_user_id']:
            raise ScanFailure('authorization_expired')
        await github.authorize_repository(owner['token'], job['installation_id'], job['repository_id'])
        if self.app.state.sessions.get(job['owner_session']) is not owner:
            raise ScanFailure('authorization_expired')

    async def worker(self):
        while True:
            job_id = await self.queue.get()
            job = self.app.state.jobs.get(job_id)
            try:
                if job is None or job['status'] != 'queued':
                    continue  # duplicate queue delivery cannot scan or dispatch twice
                async with asyncio.timeout(120):
                    job['status'] = 'scanning'
                    await self.authorize(job)
                    # Normalize here even for injected runners; empty/invalid output cannot dispatch.
                    try:
                        async with asyncio.timeout(SCAN_TIMEOUT):
                            raw = await self.scanner(job['website_url'])
                    except TimeoutError:
                        raise ScanFailure('scan_timed_out') from None
                    audit = normalize_audit(raw, job['website_url'])
                    await self.authorize(job)
                    credential = secrets.token_urlsafe(32)
                    job.update(status='dispatching', credential_hash=hashlib.sha256(credential.encode()).hexdigest(),
                               summary=audit['summary'])
                    payload = {'schema_version': 1, 'job_id': job['id'], 'website_url': job['website_url'],
                               'repository': job['repository'], 'requested_by': job['owner_user_id'],
                               'base_sha': job['base_sha'], 'audit': audit,
                               'source_service': {'credential': credential, 'expires_at': int(job['expires']),
                                   'tree_path': f"/service/jobs/{job['id']}/tree",
                                   'source_path': f"/service/jobs/{job['id']}/source"}}
                    try:
                        result = await bounded_request(self.app.state.http, 'POST', self.settings.n8n_webhook_url,
                            max_bytes=65536, json=payload, headers={
                                'X-AccessPilot-Secret': self.settings.n8n_webhook_secret,
                                'Idempotency-Key': job['id']})
                    except HTTPException:
                        self.fail(job, 'dispatch_unknown')
                        continue
                    if not result.is_success:
                        self.fail(job, 'dispatch_rejected')
                    else:
                        job['status'] = 'submitted'
            except ScanFailure as error:
                self.fail(job, error.code)
            except HTTPException:
                self.fail(job, 'authorization_failed')
            except TimeoutError:
                self.fail(job, 'job_timed_out')
            except asyncio.CancelledError:
                if job:
                    self.fail(job, 'backend_stopped')
                raise
            except Exception:
                if job:
                    self.fail(job, 'scanner_failed')
            finally:
                self.queue.task_done()
