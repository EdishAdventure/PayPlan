"""No real OpenAI calls or financial data required for these tests."""
import io
from PIL import Image
from fastapi.testclient import TestClient
import app
import payroll_ai


def test_payroll_schema_preserves_required_nullable_fields():
    """Schema generation must work in the backend's Python 3.9 environment."""
    schema = payroll_ai.PayrollFields.model_json_schema()
    assert set(schema['required']) == set(schema['properties'])
    for name in ('currency', 'employer', 'payDate', 'periodStart', 'periodEnd', *payroll_ai.AMOUNTS):
        assert {'type': 'null'} in schema['properties'][name]['anyOf']
    assert schema['additionalProperties'] is False


def screenshot(color='white', size=(480, 320)):
    img = Image.new('RGB', size, color)
    out = io.BytesIO()
    img.save(out, format='PNG')
    return out.getvalue()


def test_mock_requires_image_but_not_login():
    with TestClient(app.app) as c:
        r = c.post('/api/payroll/extract?mode=mock', files={'file': ('mock.png', screenshot(), 'image/png')})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data['mock'] is True
        assert data['payroll']['status'] == 'draft'
        assert data['payroll']['gross'] == 164825
        assert data['payroll']['net'] == 124019
        assert data['payroll']['withheld'] == 40806
        assert any('NOT extracted' in w for w in data['warnings'])
        assert data['payroll']['documentId'] is None


def test_upload_rejects_invalid_file_and_giant_file():
    with TestClient(app.app) as c:
        r = c.post('/api/payroll/extract?mode=mock', files={'file': ('file.txt', b'not a picture', 'text/plain')})
        assert r.status_code == 415
        r = c.post('/api/payroll/extract?mode=mock', files={'file': ('file.png', b'not really png', 'image/png')})
        assert r.status_code == 415
        r = c.post('/api/payroll/extract?mode=mock', files={'file': ('file.png', b'0' * (10*1024*1024+1), 'image/png')})
        assert r.status_code == 413
        r = c.post('/api/payroll/extract?mode=mock', files={'file': ('tiny.png', screenshot(size=(20,20)), 'image/png')})
        assert r.status_code == 413


def test_real_requires_authenticated_user():
    with TestClient(app.app) as c:
        r = c.post('/api/payroll/extract?mode=openai', files={'file': ('mock.png', screenshot(), 'image/png')})
        assert r.status_code == 401


def test_authenticated_real_requires_server_key(monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    with TestClient(app.app) as c:
        user = c.post('/api/auth/register', json={'email': 'scan-test-'+__import__('uuid').uuid4().hex+'@example.test', 'password': 'demo-demo-password!'})
        assert user.status_code == 201
        r = c.post('/api/payroll/extract?mode=openai', files={'file': ('mock.png', screenshot(), 'image/png')})
        assert r.status_code == 503
        assert 'OPENAI_API_KEY' in r.text


def test_real_response_uses_stub_model_without_api_call(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key-used-only-in-mock')
    called = []
    def fake_model(clean_jpeg):
        assert clean_jpeg[:3] == b'\xff\xd8\xff'
        called.append(True)
        return payroll_ai.PayrollFields(**{**payroll_ai.mock_fields().model_dump(), 'warnings': []})
    monkeypatch.setattr(payroll_ai, 'call_openai', fake_model)
    with TestClient(app.app) as c:
        c.post('/api/auth/register', json={'email': 'model-test-'+__import__('uuid').uuid4().hex+'@example.test', 'password': 'demo-demo-password!'})
        r=c.post('/api/payroll/extract?mode=openai',files={'file':('payslip.png',screenshot(), 'image/png')})
        assert r.status_code == 200, r.text
        payload=r.json()
        assert payload['mock'] is False
        assert payload['payroll']['status']=='draft'
        assert payload['payroll']['source']=='AI extraction (image not stored)'
        assert called == [True]
        assert c.get('/api/state').json()['data']['payrolls']==[]  # extraction alone never saves


def test_inconsistent_pay_amounts_are_warned_not_autofixed():
    x=payroll_ai.mock_fields().model_copy(update={'net': 999.00, 'warnings': []})
    r=payroll_ai.make_draft(x,mock=False)
    assert r['payroll']['net']==99900
    assert any('does not equal' in w for w in r['warnings'])


def test_bad_currency_and_multiple_payrolls_are_rejected():
    from fastapi import HTTPException
    for item in [payroll_ai.mock_fields().model_copy(update={'currency': 'USD'}),payroll_ai.mock_fields().model_copy(update={'isPayroll': False})]:
        try:payroll_ai.make_draft(item, mock=False)
        except HTTPException as e: assert e.status_code==422
        else: raise AssertionError('Expected rejected extraction')


def test_unexpected_error_is_still_json(monkeypatch):
    """The UI must never receive bare `Internal Server Error` for unknown failures."""
    def fail_normalizing(*args, **kwargs):
        raise RuntimeError('simulated server-side problem')
    monkeypatch.setattr(payroll_ai, 'normalize_image', fail_normalizing)
    with TestClient(app.app, raise_server_exceptions=False) as client:
        response = client.post(
            '/api/payroll/extract?mode=mock',
            files={'file': ('stub.png', screenshot(), 'image/png')},
        )
    assert response.status_code == 500
    assert response.headers['content-type'].startswith('application/json')
    payload = response.json()
    assert payload['code'] == 'INTERNAL_SERVER_ERROR'
    assert 'simulated server-side problem' not in response.text


def test_project_root_launch_can_extract_mock(tmp_path):
    """Reproduces and guards against `No module named payroll_ai` in package-mode."""
    import subprocess
    import sys
    import os
    from pathlib import Path
    workdir = Path(__file__).resolve().parent.parent
    script = '''
import io
from PIL import Image
from fastapi.testclient import TestClient
from backend.app import app
img=io.BytesIO()
Image.new('RGB', (500, 300), 'white').save(img, 'PNG')
with TestClient(app) as client:
    result=client.post('/api/payroll/extract?mode=mock', files={'file': ('stub.png',img.getvalue(),'image/png')})
    assert result.status_code == 200, result.text
    assert result.json()['mock'] is True
'''
    environment = {**os.environ, 'PAYPLAN_DB_PATH': str(tmp_path / 'root-launch.sqlite3')}
    result = subprocess.run([sys.executable, '-c', script], cwd=str(workdir), env=environment, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr


def test_provider_failure_returns_readable_json(monkeypatch):
    """A provider exception must not turn into a non-JSON response or leak internals."""
    import uuid
    monkeypatch.setenv('OPENAI_API_KEY', 'example-test-key')
    def break_provider(*args, **kwargs):
        raise RuntimeError('Sensitive provider detail not safe to show')
    monkeypatch.setattr(payroll_ai, 'call_openai', break_provider)
    with TestClient(app.app) as client:
        account = client.post('/api/auth/register', json={'email':f'extractor-{uuid.uuid4().hex}@example.test','password':'not-the-real-password'})
        assert account.status_code == 201
        result=client.post('/api/payroll/extract?mode=openai',files={'file':('stub.png',screenshot(),'image/png')})
    assert result.status_code in (502, 503)
    assert result.headers['content-type'].startswith('application/json')
    assert result.json()['detail']  # AI error or SDK installation guidance
    assert 'Sensitive provider detail' not in result.text


def test_missing_openai_sdk_is_clear_json(monkeypatch):
    """A missing OpenAI dependency used to escape the old error handler as HTTP 500 text."""
    import uuid
    monkeypatch.setenv('OPENAI_API_KEY', 'test-placeholder')
    def missing_package(*args, **kwargs):
        raise ModuleNotFoundError("No module named 'openai'", name='openai')
    monkeypatch.setattr(payroll_ai, 'call_openai', missing_package)
    with TestClient(app.app) as client:
        account = client.post('/api/auth/register', json={'email':f'package-{uuid.uuid4().hex}@example.test','password':'not-the-real-password'})
        assert account.status_code == 201
        result = client.post('/api/payroll/extract?mode=openai', files={'file':('stub.png', screenshot(), 'image/png')})
    assert result.status_code == 503
    assert 'OpenAI Python SDK is not installed' in result.json()['detail']
