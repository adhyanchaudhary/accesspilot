import pytest


@pytest.fixture
def axe_report():
    return {'testEngine': {'name': 'axe-core', 'version': '4.10.3'},
        'url': 'https://example.com', 'violations': [{
            'id': 'image-alt', 'impact': 'critical', 'description': 'Images must have alternative text',
            'help': 'Images must have alternative text', 'helpUrl': 'https://dequeuniversity.com/rules/axe/image-alt',
            'nodes': [{'html': '<img src="hero.png">', 'target': ['#hero img'],
                'failureSummary': 'Fix missing alternative text', 'any': [
                    {'id': 'has-alt', 'impact': 'critical', 'message': 'Element has no alt attribute',
                     'data': {'selector': '#hero img'}, 'relatedNodes': []}], 'all': [], 'none': []}]}]}


@pytest.fixture(autouse=True)
def offline_scanner(monkeypatch, axe_report):
    # No test launches a real scanner unless it explicitly exercises the subprocess adapter.
    class MockScanner:
        async def __call__(self, url):
            return axe_report
    monkeypatch.setattr('backend.audit_jobs.ScannerRunner', MockScanner)
