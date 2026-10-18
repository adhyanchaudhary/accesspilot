"""Server-only GitHub App and user authentication helpers."""
import os
import time
from dataclasses import dataclass
from pathlib import Path

import httpx
import jwt
from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv(Path(__file__).with_name('.env'))


@dataclass
class Settings:
    app_id: str = ''
    client_id: str = ''
    client_secret: str = ''
    private_key: str = ''
    app_slug: str = ''
    callback_url: str = 'http://localhost:8000/auth/github/callback'
    frontend_origin: str = 'http://localhost:3000'
    cookie_secure: bool = False
    n8n_webhook_url: str = ''
    n8n_webhook_secret: str = ''

    @classmethod
    def from_env(cls):
        key = os.getenv('GITHUB_PRIVATE_KEY', '').replace('\\n', '\n')
        key_path = os.getenv('GITHUB_PRIVATE_KEY_PATH', '')
        if not key and key_path:
            try:
                key = Path(key_path).expanduser().read_text()
            except OSError:
                raise RuntimeError('Cannot read GITHUB_PRIVATE_KEY_PATH') from None
        return cls(
            app_id=os.getenv('GITHUB_APP_ID', ''),
            client_id=os.getenv('GITHUB_CLIENT_ID', ''),
            client_secret=os.getenv('GITHUB_CLIENT_SECRET', ''),
            private_key=key,
            app_slug=os.getenv('GITHUB_APP_SLUG', ''),
            callback_url=os.getenv('GITHUB_CALLBACK_URL', cls.callback_url),
            frontend_origin=os.getenv('FRONTEND_ORIGIN', cls.frontend_origin),
            cookie_secure=os.getenv('COOKIE_SECURE', 'false').lower() == 'true',
            n8n_webhook_url=os.getenv('N8N_WEBHOOK_URL', ''),
            n8n_webhook_secret=os.getenv('N8N_WEBHOOK_SECRET', ''),
        )


def app_jwt(settings: Settings) -> str:
    if not settings.app_id or not settings.private_key:
        raise HTTPException(503, 'GitHub App credentials are not configured')
    now = int(time.time())
    try:
        return jwt.encode({'iat': now - 60, 'exp': now + 540, 'iss': settings.app_id},
                          settings.private_key, algorithm='RS256')
    except (ValueError, TypeError, jwt.PyJWTError):
        raise HTTPException(503, 'GitHub App signing key is invalid') from None


class GitHub:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings, self.client = settings, client

    async def request(self, method, path, token, **kwargs):
        try:
            response = await self.client.request(
                method, 'https://api.github.com' + path,
                headers={'Authorization': f'Bearer {token}',
                         'Accept': 'application/vnd.github+json',
                         'X-GitHub-Api-Version': '2022-11-28'}, **kwargs)
        except httpx.RequestError:
            raise HTTPException(502, 'GitHub is unavailable') from None
        if response.status_code == 401:
            raise HTTPException(401, 'GitHub authorization expired or was revoked; log in again')
        if response.status_code in (403, 404):
            raise HTTPException(403, 'GitHub access denied or rate limited')
        if not response.is_success:
            raise HTTPException(502, 'GitHub API request failed')
        try:
            return response.json()
        except ValueError:
            raise HTTPException(502, 'Invalid GitHub response') from None

    async def pages(self, path, token, field=None):
        result = []
        for page in range(1, 101):
            data = await self.request('GET', path, token, params={'per_page': 100, 'page': page})
            batch = data[field] if field else data
            result.extend(batch)
            if len(batch) < 100:
                return result
        raise HTTPException(502, 'GitHub pagination limit reached; refusing incomplete authorization data')

    async def installations(self):
        """Administrative helper; deliberately not exposed to browser users."""
        return await self.pages('/app/installations', app_jwt(self.settings))

    async def installation_token(self, installation_id, repository_id):
        # Fresh tokens avoid expired-cache races. Grant read-only access to one repository.
        return await self.request('POST', f'/app/installations/{installation_id}/access_tokens',
                                  app_jwt(self.settings), json={
                                      'repository_ids': [repository_id],
                                      'permissions': {'contents': 'read'}})

    async def repositories(self, user_token, installation_id=None):
        installations = await self.pages('/user/installations', user_token, 'installations')
        authorized = [i for i in installations if str(i.get('app_id')) == self.settings.app_id
                      and not i.get('suspended_at')]
        if installation_id is not None:
            authorized = [i for i in authorized if i['id'] == installation_id]
            if not authorized:
                raise HTTPException(403, 'Installation is not authorized for this user')
        result = []
        for installation in authorized:
            repos = await self.pages(f"/user/installations/{installation['id']}/repositories",
                                     user_token, 'repositories')
            for repo in repos:
                result.append({'id': repo['id'], 'full_name': repo['full_name'],
                               'private': repo['private'], 'default_branch': repo['default_branch'],
                               'installation_id': installation['id']})
        return result

    async def authorize_repository(self, user_token, installation_id, repository_id):
        repos = await self.repositories(user_token, installation_id)
        repo = next((r for r in repos if r['id'] == repository_id), None)
        if repo is None:
            raise HTTPException(403, 'Repository is not authorized for this user')
        # Check the live installation grant as well as the user grant.
        credential = await self.installation_token(installation_id, repository_id)
        installed = await self.pages('/installation/repositories', credential['token'], 'repositories')
        if not any(r['id'] == repository_id for r in installed):
            raise HTTPException(403, 'Repository is not authorized for this installation')
        return repo

    async def exchange_code(self, code, verifier):
        if not self.settings.client_id or not self.settings.client_secret:
            raise HTTPException(503, 'GitHub OAuth credentials are not configured')
        try:
            response = await self.client.post('https://github.com/login/oauth/access_token',
                headers={'Accept': 'application/json'}, data={
                    'client_id': self.settings.client_id, 'client_secret': self.settings.client_secret,
                    'code': code, 'redirect_uri': self.settings.callback_url, 'code_verifier': verifier})
            data = response.json()
        except (httpx.RequestError, ValueError):
            raise HTTPException(502, 'GitHub OAuth exchange failed') from None
        if not response.is_success or not data.get('access_token') or data.get('error'):
            raise HTTPException(401, 'GitHub OAuth authorization failed')
        return data
