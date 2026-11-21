"""Check HTTP/TLS, same-origin routing and signed empty LINE verification requests.

No user messages are sent; no secret values are written to the report.
"""
from pathlib import Path
from urllib.parse import urlsplit
import base64
import hashlib
import hmac
import json
import sys
import urllib.error
import urllib.request

root = Path(__file__).resolve().parents[2]
base = sys.argv[1].rstrip('/')
parsed = urlsplit(base)
if not ((parsed.scheme == 'https' and parsed.hostname.endswith('.ecs.ap-southeast-1.on.aws'))
        or (parsed.scheme == 'http' and parsed.hostname == '127.0.0.1')):
    raise SystemExit('Expected the Agrimatch ECS HTTPS endpoint or a local loopback test endpoint.')
values = dict(line.split('=', 1) for line in (root / '.env').read_text().splitlines()
              if '=' in line and not line.lstrip().startswith('#'))
checks = []


def request(path, expected, body=None, headers=None):
    req = urllib.request.Request(base + path, data=body, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            status = response.status
    except urllib.error.HTTPError as error:
        status = error.code
    checks.append({'path': path, 'expected': expected, 'actual': status, 'passed': status == expected})
    if status != expected:
        raise RuntimeError(f'{path}: expected {expected}, got {status}')


request('/healthz', 200)
request('/login', 200)
request('/api/me', 401)
body = b'{"events":[]}'
for role in ['farmer', 'baler', 'factory']:
    secret = values[f'LINE_{role.upper()}_CHANNEL_SECRET']
    signature = base64.b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).decode()
    request(f'/webhooks/line/{role}', 200, body, {'Content-Type': 'application/json', 'x-line-signature': signature})
    request(f'/webhooks/line/{role}', 401, body, {'Content-Type': 'application/json'})
print(json.dumps({'base_url': base, 'checks': checks, 'passed': True}, indent=2))
