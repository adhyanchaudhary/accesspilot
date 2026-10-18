import asyncio
import socket

import pytest

from backend.scan_network import PublicScanProxy, ScanNetworkError, public_ipv4


@pytest.mark.parametrize('addresses', [['127.0.0.1'], ['10.1.2.3'], ['169.254.169.254'],
    ['168.63.129.16'], ['93.184.216.34', '192.168.1.1'], ['::1'], ['64:ff9b::a00:1']])
def test_dns_rejects_private_mixed_and_ipv6_transition_addresses(monkeypatch, addresses):
    async def run():
        async def resolve(*args, **kwargs):
            return [(socket.AF_INET, socket.SOCK_STREAM, 0, '', (ip, 80)) for ip in addresses]
        monkeypatch.setattr(asyncio.get_running_loop(), 'getaddrinfo', resolve)
        with pytest.raises(ScanNetworkError):
            await public_ipv4('example.com', 80)
    asyncio.run(run())


def test_proxy_pins_public_ip_and_blocks_redirect_subresource_targets(monkeypatch):
    async def run():
        real_open = asyncio.open_connection
        connections = []
        async def resolve(host, port):
            if host != 'example.com':
                raise ScanNetworkError()
            return '93.184.216.34'
        class Writer:
            def __init__(self):
                self.data = bytearray()
            def write(self, value):
                self.data.extend(value)
            async def drain(self):
                pass
            def close(self):
                pass
        async def open_connection(host, port, **kwargs):
            if host == '127.0.0.1':
                return await real_open(host, port, **kwargs)
            connections.append((host, port))
            reader = asyncio.StreamReader()
            reader.feed_data(b'HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/secret\r\nContent-Length: 0\r\n\r\n')
            reader.feed_eof()
            return reader, Writer()
        monkeypatch.setattr('backend.scan_network.public_ipv4', resolve)
        monkeypatch.setattr(asyncio, 'open_connection', open_connection)
        async with PublicScanProxy() as proxy:
            port = proxy.server.sockets[0].getsockname()[1]
            async def request(line):
                reader, writer = await real_open('127.0.0.1', port)
                writer.write((line + '\r\nHost: example.com\r\n\r\n').encode())
                await writer.drain()
                response = await asyncio.wait_for(reader.read(), 2)
                writer.close()
                await writer.wait_closed()
                return response
            assert b'302 Found' in await request('GET http://example.com/ HTTP/1.1')
            for target in ['http://127.0.0.1/secret', 'http://169.254.169.254/latest/meta-data',
                           'http://10.0.0.1/image.png', 'http://example.com:8080/admin']:
                assert await request(f'GET {target} HTTP/1.1') == b''
            assert await request('CONNECT 127.0.0.1:443 HTTP/1.1') == b''
            assert connections == [('93.184.216.34', 80)]  # actual connect never re-resolves hostname
    asyncio.run(run())
