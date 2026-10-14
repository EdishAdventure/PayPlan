import os
from pathlib import Path
os.environ['PAYPLAN_DB_PATH']='/tmp/payplan_standalone_tests.sqlite3'
try: Path(os.environ['PAYPLAN_DB_PATH']).unlink()
except FileNotFoundError: pass
from fastapi.testclient import TestClient
from app import app,empty_workspace,require_valid_workspace

def test_workspace_basics():
    w=empty_workspace()
    assert require_valid_workspace(w)['schemaVersion']==1


def test_auth_and_versioning():
    with TestClient(app) as c:
        assert c.get('/api/health').status_code==200
        assert c.get('/api/state').status_code==401
        r=c.post('/api/auth/register',json={'email':'demo@example.com','password':'examplepassword!'});assert r.status_code==201,r.text
        r=c.get('/api/state'); assert r.status_code==200 and r.json()['version']==0
        state=r.json()['data']; state['settings']={'buffer':100000,'scheduleReviewed':True}
        assert c.put('/api/state',json={'version':0,'data':state}).json()['version']==1
        assert c.put('/api/state',json={'version':0,'data':state}).status_code==409
        bad=state.copy();bad['plan']=[{'id':'x','label':'Bad','kind':'bill','amount':-100,'frequency':'monthly','category':'essentials','nextDate':None,'monthDay':None,'status':'confirmed','reserved':0,'accountId':None,'notes':''}]
        assert c.put('/api/state',json={'version':1,'data':bad}).status_code==422
        assert c.post('/api/auth/logout').status_code==200
        assert c.get('/api/state').status_code==401


def test_user_isolation_and_conflicts():
    with TestClient(app) as a, TestClient(app) as b:
        a.post('/api/auth/register',json={'email':'alice@example.com','password':'examplepassword!'});
        b.post('/api/auth/register',json={'email':'bob@example.com','password':'examplepassword!'});
        w=a.get('/api/state').json()['data'];w['snapshots'].append({'id':'s1','date':'2026-10-14','notes':'Alice','balances':{'chequing':20000,'savings':200,'card':10}})
        assert a.put('/api/state',json={'version':0,'data':w}).status_code==200
        assert b.get('/api/state').json()['data']['snapshots']==[]

def test_confirmed_payroll_history_is_immutable():
    with TestClient(app) as c:
        c.post('/api/auth/register',json={'email':'ledger@example.com','password':'examplepassword!'})
        w=empty_workspace()
        p={'id':'pay1','employer':'Demo','payDate':'2026-09-18','periodStart':'2026-09-01','periodEnd':'2026-09-15','gross':15000,'net':10000,'withheld':5000,'hours':4000,'status':'confirmed','replaces':None,'documentId':None,'source':'Manual entry','notes':''}
        for k in ('regular','tips','vacation','holiday','otherEarnings','federalTax','quebecTax','ei','qpip','qpp','qppExtra','otherDeductions','ytdGross','ytdNet','ytdWithheld'):
            p[k]=None
        w['payrolls']=[p]
        assert c.put('/api/state',json={'version':0,'data':w}).status_code==200
        changed=__import__('copy').deepcopy(w)
        changed['payrolls'][0]['gross']=25000
        changed['payrolls'][0]['net']=20000
        assert c.put('/api/state',json={'version':1,'data':changed}).status_code==422
        changed['payrolls'][0]=dict(p,status='superseded')
        new=dict(p,id='pay2',gross=20000,net=15000,replaces='pay1')
        changed['payrolls'].append(new)
        assert c.put('/api/state',json={'version':1,'data':changed}).status_code==200
