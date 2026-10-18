"""Bounded HTTP transport and ASGI request perimeter; never log request data."""
import asyncio
import time
from collections import deque

import httpx
from fastapi import HTTPException
from starlette.responses import JSONResponse

MAX_REQUEST_BYTES = 32 * 1024
MAX_UPSTREAM_BYTES = 8 * 1024 * 1024
REQUEST_DEADLINE = 60
UPSTREAM_DEADLINE = 20


async def bounded_request(client, method, url, *, max_bytes=MAX_UPSTREAM_BYTES, **kwargs):
    """Limit decoded bytes (including compressed responses) and total wall time."""
    try:
        async with asyncio.timeout(UPSTREAM_DEADLINE):
            async with client.stream(method, url, **kwargs) as response:
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(content) + len(chunk) > max_bytes:
                        raise HTTPException(502, 'Upstream response exceeds the size limit')
                    content.extend(chunk)
                return httpx.Response(response.status_code, content=bytes(content), request=response.request)
    except (httpx.RequestError, TimeoutError):
        raise HTTPException(502, 'Upstream request failed or timed out') from None


class RequestBoundary:
    """Actual body-byte limit, total deadline, fixed dev rate limit and safe errors."""
    def __init__(self, app, tunnel_mode=False):
        self.app = app
        self.tunnel_mode = tunnel_mode
        self.requests = deque()
        self.logins = deque()

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        started = False

        async def safe_send(message):
            nonlocal started
            if message['type'] == 'http.response.start':
                started = True
                headers = [(k, v) for k, v in message['headers'] if k.lower() not in
                           (b'cache-control', b'x-content-type-options', b'referrer-policy')]
                message['headers'] = headers + [(b'cache-control', b'no-store'),
                    (b'x-content-type-options', b'nosniff'), (b'referrer-policy', b'no-referrer')]
            await send(message)

        async def error(status, detail):
            if not started:
                await JSONResponse({'detail': detail}, status_code=status)(scope, receive, safe_send)

        try:
            async with asyncio.timeout(REQUEST_DEADLINE):
                # Never consult Forwarded, X-Forwarded-* or CF-* for identity or limits.
                if len(scope.get('query_string', b'')) + len(scope.get('raw_path', b'')) > 4096:
                    return await error(414, 'Request URL is too long')
                if sum(len(k) + len(v) for k, v in scope['headers']) > 16384:
                    return await error(431, 'Request headers are too large')
                if self.tunnel_mode:
                    now = time.monotonic()
                    for queue in (self.requests, self.logins):
                        while queue and queue[0] <= now - 60:
                            queue.popleft()
                    login = scope['path'] == '/auth/github/login'
                    if len(self.requests) >= 120 or (login and len(self.logins) >= 10):
                        return await error(429, 'Development request limit reached; retry later')
                    self.requests.append(now)
                    if login:
                        self.logins.append(now)
                lengths = [v for k, v in scope['headers'] if k.lower() == b'content-length']
                if lengths:
                    if len(lengths) != 1 or not lengths[0].isdigit():
                        return await error(400, 'Invalid Content-Length')
                    if int(lengths[0]) > MAX_REQUEST_BYTES:
                        return await error(413, 'Request body exceeds the size limit')
                body = bytearray()
                while True:
                    message = await receive()
                    if message['type'] == 'http.disconnect':
                        return
                    chunk = message.get('body', b'')
                    if len(body) + len(chunk) > MAX_REQUEST_BYTES:
                        return await error(413, 'Request body exceeds the size limit')
                    body.extend(chunk)
                    if not message.get('more_body', False):
                        break
                consumed = False

                async def replay():
                    nonlocal consumed
                    if not consumed:
                        consumed = True
                        return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
                    return await receive()

                await self.app(scope, replay, safe_send)
        except TimeoutError:
            await error(504, 'Request deadline exceeded')
        except Exception:
            # Deliberately do not include exception text, URLs, headers or tracebacks.
            await error(500, 'Internal server error')
