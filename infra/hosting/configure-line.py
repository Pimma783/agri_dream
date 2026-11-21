"""Set role webhook URLs and request LINE's empty-event verification. Never enables traffic."""
from pathlib import Path
import json
import urllib.request
import urllib.error

root=Path(__file__).resolve().parents[2]
s=json.loads((root/'infra/hosting/state/aws.json').read_text())
values=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if '=' in line and not line.lstrip().startswith('#'))
report=[]
for role in ['farmer','baler','factory']:
    def call(method,path,body=None):
        req=urllib.request.Request('https://api.line.me/v2/bot/channel/webhook/'+path,
            data=json.dumps(body).encode() if body is not None else None, method=method,
            headers={'Authorization':'Bearer '+values[f'LINE_{role.upper()}_ACCESS_TOKEN'],'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(req,timeout=35) as response:
                data=response.read(); return json.loads(data) if data else {}
        except urllib.error.HTTPError as error:
            if method == 'GET' and path == 'endpoint' and error.code == 404: return {}
            raise RuntimeError(f'LINE {role} {method} {path}: HTTP {error.code}') from None
    old=call('GET','endpoint')
    if old.get('active') is True: raise RuntimeError(f'{role}: live webhook already active; review before changing URL')
    endpoint=s['url']+'/webhooks/line/'+role
    call('PUT','endpoint',{'endpoint':endpoint})
    result=call('POST','test',{'endpoint':endpoint})
    current=call('GET','endpoint')
    row={'role':role,'endpoint':current.get('endpoint'),'active':current.get('active'),
         'success':result.get('success'),'statusCode':result.get('statusCode'),'reason':result.get('reason')}
    report.append(row)
    print(json.dumps(row),flush=True)
    if not result.get('success') or current.get('endpoint')!=endpoint or current.get('active') is True:
        raise RuntimeError(f'LINE {role} endpoint verification failed')
(root/'infra/hosting/state/line-webhook-check.json').write_text(json.dumps({'checks':report,'passed':True},indent=2))
