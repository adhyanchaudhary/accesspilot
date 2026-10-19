"""Reproduce package visibility loss under isolated HOME/APPDATA without a browser."""
import json
import os
from pathlib import Path
import site
import subprocess
import sys

import pytest

from backend import scanner_platform
from backend import scanner_diagnostics as diagnostics


def test_user_packages_survive_scanner_profile_isolation(tmp_path):
    # A fresh virtual environment enables user installs but has no third-party deps.
    # Only this test's controlled user site supplies the scanner's two direct imports.
    import venv
    prefix = tmp_path / 'python'
    venv.EnvBuilder(with_pip=False, system_site_packages=True).create(prefix)
    interpreter = prefix / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    base = tmp_path / 'real-user-base'
    initial = {**os.environ, 'PYTHONUSERBASE': str(base)}
    initial.pop('PYTHONNOUSERSITE', None)
    initial.pop('PYTHONPATH', None)
    user_site = subprocess.check_output([str(interpreter), '-c',
        'import site; print(site.getusersitepackages())'], env=initial, text=True).strip()
    package_dir = Path(user_site)
    for name in ('playwright', 'axe_playwright_python'):
        (package_dir / name).mkdir(parents=True, exist_ok=True)
        (package_dir / name / '__init__.py').write_text('')
    (package_dir / 'playwright' / 'sync_api.py').write_text('sync_playwright = object()\nTimeoutError = TimeoutError\n')
    (package_dir / 'axe_playwright_python' / 'sync_playwright.py').write_text('Axe = object()\n')
    (package_dir / 'accesspilot_user_dependency_probe.py').write_text('PRESENT = True\n')
    work = tmp_path / 'work'
    work.mkdir()
    # Run environment construction in the same parent interpreter that owns the user packages.
    source = f'''
import json, sys, site
sys.path.insert(0, {str(Path(__file__).resolve().parents[2])!r})
from backend.scanner_platform import scanner_environment
from playwright.sync_api import sync_playwright
from axe_playwright_python.sync_playwright import Axe
print(json.dumps({{'env':scanner_environment({str(work)!r}), 'executable':sys.executable,
                  'user_site':site.getusersitepackages()}}))
'''
    info = json.loads(subprocess.check_output([str(interpreter), '-c', source], env=initial, text=True))
    code = ('import json,sys; import accesspilot_user_dependency_probe; from playwright.sync_api import sync_playwright; '
            'from axe_playwright_python.sync_playwright import Axe; '
            'import playwright; print(json.dumps({"executable":sys.executable,"module":playwright.__file__}))')
    child = json.loads(subprocess.check_output([info['executable'], '-c', code],
        cwd=work, env=info['env'], text=True))
    assert child['executable'] == info['executable']
    assert Path(child['module']).parent.parent == package_dir
    assert info['env']['HOME'] == str(work)
    assert 'PYTHONPATH' not in info['env'] and 'PYTHONHOME' not in info['env']
    assert info['env']['PYTHONUSERBASE'] == str(base)
    # Reproduce the old bug deterministically: move the user base with the isolated profile.
    old_env = dict(info['env'], PYTHONUSERBASE=str(work / 'empty-user-base'))
    missing = subprocess.run([info['executable'], '-c', code], cwd=work, env=old_env,
        capture_output=True, text=True)
    assert missing.returncode != 0
    assert "No module named 'accesspilot_user_dependency_probe'" in missing.stderr


def test_disabled_user_site_is_not_reenabled(tmp_path, monkeypatch):
    monkeypatch.setattr(site, 'ENABLE_USER_SITE', False)
    env = scanner_platform.scanner_environment(str(tmp_path))
    assert env['PYTHONNOUSERSITE'] == '1' and 'PYTHONUSERBASE' not in env


def test_windows_user_base_and_browser_profiles_are_separate(tmp_path, monkeypatch):
    monkeypatch.setattr(scanner_platform, 'is_windows', lambda: True)
    monkeypatch.setenv('SystemRoot', str(tmp_path / 'Windows'))
    monkeypatch.setattr(site, 'ENABLE_USER_SITE', True)
    monkeypatch.setattr(site, 'getuserbase', lambda: str(tmp_path / 'real-user-base'))
    monkeypatch.setenv('PYTHONPATH', 'must-not-be-inherited')
    monkeypatch.setenv('GITHUB_PRIVATE_KEY', 'must-not-be-inherited')
    env = scanner_platform.scanner_environment(str(tmp_path / 'workspace'))
    assert env['PYTHONUSERBASE'] == str(tmp_path / 'real-user-base')
    assert env['APPDATA'] == env['USERPROFILE'] == str(tmp_path / 'workspace')
    assert 'PYTHONPATH' not in env and 'GITHUB_PRIVATE_KEY' not in env


@pytest.mark.parametrize('module', ['playwright', 'playwright.sync_api', 'axe_playwright_python',
    'greenlet', 'greenlet._greenlet', 'pyee.asyncio', 'typing_extensions'])
def test_missing_module_is_reported_without_exception_message(module, caplog):
    error = ModuleNotFoundError('SECRET-MESSAGE', name=module)
    diagnostics.log(diagnostics.record('dependencies', 'dependency_missing', error))
    assert f'"missing_module": "{module}"' in caplog.text
    assert 'SECRET-MESSAGE' not in caplog.text


def test_untrusted_missing_module_is_not_logged(caplog):
    error = ModuleNotFoundError('secret', name='SECRET_TOKEN')
    diagnostics.log(diagnostics.record('dependencies', 'dependency_missing', error))
    assert 'SECRET_TOKEN' not in caplog.text
