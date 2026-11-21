"""Run and clean an isolated setup-code -> assignment -> enrollment QA flow."""
import json
import shlex
from datetime import datetime, timezone
from pathlib import Path

import paramiko


HOST = "178.238.227.229"

REMOTE_QA = r'''
import json, subprocess, urllib.error, urllib.request, uuid
from datetime import datetime, timezone

SCHOOL="14eea188-73b1-40bc-8f8d-15afbea27ffa"
API="https://api.robokorda.duckdns.org"
PSQL=["docker","exec","-i","supabase-db","psql","-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-U","supabase_admin","-d","postgres"]
stamp=datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
serial="QA-V18-"+stamp
secret=str(uuid.uuid4())
device_id=None
auth_user=None
code_id=None

def sql(statement):
    result=subprocess.run(PSQL,input=statement,text=True,capture_output=True,timeout=60)
    if result.returncode: raise RuntimeError(result.stderr[-1600:])
    return result.stdout.strip()

def keys():
    info=json.loads(subprocess.check_output(["docker","inspect","supabase-kong"],text=True))[0]
    env=dict(item.split("=",1) for item in info["Config"]["Env"] if "=" in item)
    anon=env.get("SUPABASE_ANON_KEY") or env.get("ANON_KEY")
    if not anon: raise RuntimeError("Kong anon key is unavailable")
    return anon

def post(path,body,expected):
    anon=keys()
    request=urllib.request.Request(API+path,data=json.dumps(body).encode(),method="POST",headers={
        "apikey":anon,"Authorization":"Bearer "+anon,"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(request,timeout=45) as response:
            status=response.status; payload=json.loads(response.read())
    except urllib.error.HTTPError as error:
        status=error.code; payload=json.loads(error.read())
    if status!=expected: raise AssertionError((path,status,payload))
    return payload

checks=[]
try:
    admin=sql("select id from public.profiles where (role='school_admin' and school_id='"+SCHOOL+"') or role='super_admin' order by (role='school_admin') desc,id limit 1")
    if not admin: raise RuntimeError("No school manager exists for isolated QA")
    issued=json.loads(sql("begin; select set_config('request.jwt.claim.sub','"+admin+"',true); set local role authenticated; select public.staff_issue_school_setup_code('"+SCHOOL+"'); commit;" ).splitlines()[-1])
    code_id=issued["id"]
    verified=post("/functions/v1/device-setup",{
        "action":"verify_code","request_secret":secret,"setup_code":issued["code"],
        "hardware_id":serial,"serial":serial,"prime_id":serial,"android_id":"qa-"+stamp,"model":"PrimeBook QA"
    },200)
    assert verified["assignment_state"]=="unassigned" and verified["school_name"]=="Rusununguko ZIMFEP High School"
    checks.append("one-time setup code verified")
    assigned=post("/functions/v1/device-setup",{
        "action":"assign","request_secret":secret,"session_id":verified["session_id"],
        "student_name":"RoboKorda Setup QA","class_form":6,"class_section":"Z"
    },200)
    device_id=assigned["device_id"]
    assert assigned["student_name"]=="RoboKorda Setup QA" and len(assigned["enroll_token"])==9
    checks.append("serial student and Form 6 Z assigned")
    enrolled=post("/functions/v1/enroll",{
        "token":assigned["enroll_token"],"android_id":"qa-"+stamp,"serial":serial,
        "model":"PrimeBook QA","manufacturer":"RoboKorda QA"
    },200)
    assert enrolled["device_id"]==device_id and enrolled["school_id"]==SCHOOL
    checks.append("enrollment token exchanged for device account")
    replay=post("/functions/v1/enroll",{"token":assigned["enroll_token"]},404)
    assert replay["error"]=="unknown_token"
    checks.append("enrollment token is single-use")
    row=json.loads(sql("select row_to_json(x) from (select prime_id,class_form,class_section,auth_user_id is not null as linked,enrolled_at is not null as enrolled from public.devices where id='"+device_id+"') x"))
    assert row=={"prime_id":serial,"class_form":6,"class_section":"Z","linked":True,"enrolled":True}
    checks.append("database persisted serial, class and enrollment")
finally:
    if device_id:
        raw=sql("select coalesce(auth_user_id::text,'') from public.devices where id='"+device_id+"'")
        auth_user=raw or None
    statements=["begin;"]
    statements.append("delete from public.first_boot_sessions where hardware_id='"+serial+"';")
    if device_id: statements.append("delete from public.devices where id='"+device_id+"';")
    if code_id: statements.append("delete from public.school_setup_codes where id='"+code_id+"';")
    if auth_user: statements.append("delete from auth.users where id='"+auth_user+"';")
    statements.append("commit;")
    sql("\n".join(statements))
    leftovers=int(sql("select count(*) from public.devices where serial='"+serial+"'"))
    if leftovers: raise RuntimeError("QA cleanup left a device row")

print(json.dumps({"live_setup_checks":"passed","checks":checks,"qa_cleanup":"passed"}))
'''


def run(client, command):
    _, stdout, stderr = client.exec_command(command)
    output=stdout.read().decode(); error=stderr.read().decode(); status=stdout.channel.recv_exit_status()
    if status: raise RuntimeError(error[-2000:])
    return output.strip()


def main():
    client=paramiko.SSHClient();client.load_system_host_keys(str(Path.home()/".ssh/known_hosts"));client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(HOST,username="root",key_filename=str(Path.home()/".ssh/primesecure_support_ed25519"),timeout=15,allow_agent=False,look_for_keys=False)
    try:
        stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        remote=f"/root/primesecure-deployments/device-setup-qa-{stamp}.py"
        with client.open_sftp() as sftp:
            with sftp.open(remote,"w") as output: output.write(REMOTE_QA)
            sftp.chmod(remote,0o700)
        result=run(client,"python3 "+shlex.quote(remote))
        print(result)
    finally: client.close()


if __name__=="__main__": main()
