"""Per-scan public IPv4 HTTP/CONNECT proxy. Resolve once, connect to checked IPs."""
import asyncio
import ipaddress
from urllib.parse import urlsplit


class ScanNetworkError(Exception):
    def __init__(self, reason='policy_denied'):
        self.reason = reason if reason in ('policy_denied', 'dns_failed') else 'policy_denied'
        super().__init__(self.reason)


async def public_ipv4(host, port):
    import socket
    try:
        addresses = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(
            host, port, type=socket.SOCK_STREAM), 5)
        ips = [ipaddress.ip_address(a[4][0]) for a in addresses]
        if not ips or any(not ip.is_global or str(ip) == '168.63.129.16' for ip in ips):
            raise ScanNetworkError()
        ipv4 = next((str(ip) for ip in ips if ip.version == 4), None)
        if not ipv4:
            raise ScanNetworkError()  # No IPv6 transition/NAT64 routes.
        return ipv4
    except (ValueError, OSError, TimeoutError):
        raise ScanNetworkError('dns_failed') from None


class PublicScanProxy:
    MAX_BYTES = 32 * 1024 * 1024
    MAX_CONNECTIONS = 16

    def __init__(self):
        self.tasks = set()
        self.total = 0
        self.active = 0
        self.server = None
        self.failures = {}

    async def __aenter__(self):
        self.server = await asyncio.start_server(self.handle, '127.0.0.1', 0, limit=16384)
        self.url = f'http://127.0.0.1:{self.server.sockets[0].getsockname()[1]}'
        return self

    async def __aexit__(self, *args):
        self.server.close()
        await self.server.wait_closed()
        for task in list(self.tasks):
            task.cancel()
        await asyncio.gather(*list(self.tasks), return_exceptions=True)

    async def handle(self, reader, writer):
        task = asyncio.current_task()
        self.tasks.add(task)
        remote = None
        counted = False
        try:
            if self.active >= self.MAX_CONNECTIONS:
                raise ScanNetworkError()
            self.active += 1
            counted = True
            async with asyncio.timeout(60):
                header = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 5)
                if len(header) > 16384:
                    raise ScanNetworkError()
                lines = header.decode('latin1').split('\r\n')
                method, target, version = lines[0].split(' ')
                if version not in ('HTTP/1.0', 'HTTP/1.1') or method not in ('GET', 'HEAD', 'CONNECT'):
                    raise ScanNetworkError()
                parsed = urlsplit('https://' + target if method == 'CONNECT' else target)
                port = parsed.port or (443 if method == 'CONNECT' else 80)
                if (not parsed.hostname or parsed.username or parsed.password or parsed.fragment
                        or (method == 'CONNECT' and port != 443)
                        or (method != 'CONNECT' and (parsed.scheme != 'http' or port != 80))):
                    raise ScanNetworkError()
                ip = await public_ipv4(parsed.hostname, port)
                upstream, remote = await asyncio.wait_for(asyncio.open_connection(ip, port), 5)
                if method == 'CONNECT':
                    writer.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
                else:
                    # One HTTP request per connection; no pipelined request can choose another host.
                    path = parsed.path or '/'
                    if parsed.query:
                        path += '?' + parsed.query
                    headers = []
                    for line in lines[1:]:
                        if not line:
                            continue
                        name, value = line.split(':', 1)
                        if name.lower() in ('transfer-encoding', 'upgrade'):
                            raise ScanNetworkError()
                        if name.lower() == 'content-length' and value.strip() != '0':
                            raise ScanNetworkError()
                        if name.lower() not in ('host', 'connection', 'proxy-connection', 'proxy-authorization'):
                            headers.append(line)
                    headers += [f'Host: {parsed.hostname}', 'Connection: close']
                    remote.write((f'{method} {path} HTTP/1.1\r\n' + '\r\n'.join(headers) + '\r\n\r\n').encode('latin1'))
                    await remote.drain()
                await writer.drain()

                async def transfer(source, destination):
                    while True:
                        chunk = await asyncio.wait_for(source.read(32768), 15)
                        if not chunk:
                            break
                        self.total += len(chunk)
                        if self.total > self.MAX_BYTES:
                            raise ScanNetworkError()
                        destination.write(chunk)
                        await destination.drain()

                if method == 'CONNECT':
                    pipes = [asyncio.create_task(transfer(reader, remote)), asyncio.create_task(transfer(upstream, writer))]
                    try:
                        done, _ = await asyncio.wait(pipes, return_when=asyncio.FIRST_COMPLETED)
                        for finished in done:
                            finished.result()
                    finally:
                        for pipe in pipes:
                            pipe.cancel()
                        await asyncio.gather(*pipes, return_exceptions=True)
                else:
                    await transfer(upstream, writer)
        except ScanNetworkError as error:
            self.failures[error.reason] = self.failures.get(error.reason, 0) + 1
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, ValueError):
            self.failures['protocol_error'] = self.failures.get('protocol_error', 0) + 1
        except TimeoutError:
            self.failures['timeout'] = self.failures.get('timeout', 0) + 1
        except OSError:
            self.failures['connection_failed'] = self.failures.get('connection_failed', 0) + 1
        # Fail closed; never log URLs/headers or make a direct fallback request.
        finally:
            if counted:
                self.active -= 1
            if remote:
                remote.close()
            writer.close()
            self.tasks.discard(task)
