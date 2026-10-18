"""Local, single-worker backend. Tokens live only in expiring server memory."""
import asyncio
import base64
import hashlib
import ipaddress
import secrets
import socket
import time
from contextlib import asynccontextmanager
from urllib.parse import urlencode, urlsplit
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field

from .github_auth import GitHub, Settings


class ExpiringStore:
    def __init__(self, limit=10000):
        self.items = {}
        self.limit = limit

    def get(self, key):
        item = self.items.get(key)
        if item and item['expires'] > time.time():
            return item
        self.items.pop(key, None)
        return None

    def put(self, key, value):
        for old in list(self.items):
            self.get(old)
        if len(self.items) >= self.limit:
            raise HTTPException(503, 'Session capacity reached')
        self.items[key] = value


async def validate_website(url):
    parsed = urlsplit(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(422, 'Provide a public HTTP(S) website URL without credentials')
    try:
        if parsed.port not in (None, 80, 443):
            raise ValueError()
        addresses = await asyncio.get_running_loop().getaddrinfo(
            parsed.hostname, parsed.port or (443 if parsed.scheme == 'https' else 80),
            type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise ValueError()
    except (ValueError, OSError):
        raise HTTPException(422, 'Website must resolve exclusively to public addresses on port 80 or 443') from None


class AuditRequest(BaseModel):
    website_url: str = Field(min_length=1, max_length=2048)
    installation_id: int = Field(gt=0)
    repository_id: int = Field(gt=0)


def create_app(settings=None, transport=None):
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(timeout=20, follow_redirects=False, transport=transport) as client:
            app.state.github = GitHub(settings, client)
            app.state.http = client
            yield

    app = FastAPI(title='AccessPilot', lifespan=lifespan)
    app.state.sessions = ExpiringStore()
    app.state.states = ExpiringStore()
    app.add_middleware(CORSMiddleware, allow_origins=[settings.frontend_origin],
                       allow_credentials=True, allow_methods=['GET', 'POST'],
                       allow_headers=['Content-Type', 'X-CSRF-Token'])

    @app.middleware('http')
    async def no_store(request, call_next):
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        return response

    def cookie(response, name, value, max_age):
        response.set_cookie(name, value, max_age=max_age, httponly=True,
                            secure=settings.cookie_secure, samesite='lax', path='/')

    def session(request: Request):
        sid = request.cookies.get('accesspilot_session', '')
        value = app.state.sessions.get(sid)
        if not value:
            raise HTTPException(401, 'Login required')
        if request.method == 'POST':
            if request.headers.get('origin') != settings.frontend_origin or not secrets.compare_digest(
                    request.headers.get('x-csrf-token', ''), value['csrf']):
                raise HTTPException(403, 'Invalid request origin or CSRF token')
        return value

    @app.get('/health')
    async def health():
        return {'status': 'ok'}

    @app.get('/health/github')
    async def github_health(s=Depends(session)):
        from .github_auth import app_jwt
        await app.state.github.request('GET', '/app', app_jwt(settings))
        return {'status': 'ok'}

    @app.get('/auth/github/login')
    async def login():
        if not settings.client_id or not settings.client_secret:
            raise HTTPException(503, 'GitHub OAuth credentials are not configured')
        state, binding, verifier = (secrets.token_urlsafe(32) for _ in range(3))
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
        app.state.states.put(state, {'binding': binding, 'verifier': verifier, 'expires': time.time() + 600})
        response = RedirectResponse('https://github.com/login/oauth/authorize?' + urlencode({
            'client_id': settings.client_id, 'redirect_uri': settings.callback_url,
            'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256'}))
        cookie(response, 'accesspilot_oauth', binding, 600)
        return response

    @app.get('/auth/github/callback')
    async def callback(request: Request, state: str = '', code: str = ''):
        pending = app.state.states.get(state)
        if not pending or not secrets.compare_digest(pending['binding'], request.cookies.get('accesspilot_oauth', '')):
            raise HTTPException(400, 'Invalid or expired OAuth state')
        app.state.states.items.pop(state, None)  # single use, consumed before network calls
        if not code:
            raise HTTPException(400, 'GitHub authorization denied or code missing')
        credential = await app.state.github.exchange_code(code, pending['verifier'])
        user = await app.state.github.request('GET', '/user', credential['access_token'])
        sid, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        ttl = min(int(credential.get('expires_in', 28800)), 28800)
        app.state.sessions.put(sid, {'token': credential['access_token'], 'csrf': csrf,
            'user': {'id': user['id'], 'login': user['login']}, 'expires': time.time() + ttl})
        app.state.sessions.items.pop(request.cookies.get('accesspilot_session', ''), None)
        response = RedirectResponse(settings.frontend_origin + '/', status_code=303)
        cookie(response, 'accesspilot_session', sid, ttl)
        response.delete_cookie('accesspilot_oauth', path='/')
        return response

    @app.get('/auth/github/me')
    async def me(s=Depends(session)):
        user = await app.state.github.request('GET', '/user', s['token'])
        return {'user': {'id': user['id'], 'login': user['login']}, 'csrf_token': s['csrf']}

    @app.get('/github/install')
    async def install(s=Depends(session)):
        if not settings.app_slug:
            raise HTTPException(503, 'GITHUB_APP_SLUG is not configured')
        # Installation callbacks are never used as proof of authorization.
        return RedirectResponse(f'https://github.com/apps/{settings.app_slug}/installations/new')

    @app.get('/github/repositories')
    async def repositories(s=Depends(session)):
        return {'repositories': await app.state.github.repositories(s['token'])}

    @app.post('/auth/logout')
    async def logout(request: Request, s=Depends(session)):
        app.state.sessions.items.pop(request.cookies.get('accesspilot_session', ''), None)
        response = JSONResponse({'status': 'logged_out'})
        response.delete_cookie('accesspilot_session', path='/')
        return response

    @app.post('/audits', status_code=202)
    async def audit(body: AuditRequest, s=Depends(session)):
        repo = await app.state.github.authorize_repository(s['token'], body.installation_id, body.repository_id)
        await validate_website(body.website_url)
        parsed = urlsplit(settings.n8n_webhook_url)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or not settings.n8n_webhook_secret):
            raise HTTPException(503, 'Secure n8n webhook configuration is missing')
        job_id = str(uuid4())
        payload = {'schema_version': 1, 'job_id': job_id, 'website_url': body.website_url,
                   'repository': repo, 'requested_by': s['user']['id']}
        try:
            result = await app.state.http.post(settings.n8n_webhook_url, json=payload,
                headers={'X-AccessPilot-Secret': settings.n8n_webhook_secret})
        except httpx.RequestError:
            raise HTTPException(502, 'n8n delivery failed; acceptance is unknown, do not retry blindly') from None
        if not result.is_success:
            raise HTTPException(502, 'n8n rejected the job')
        return {'job_id': job_id, 'status': 'accepted'}

    return app


app = create_app()
