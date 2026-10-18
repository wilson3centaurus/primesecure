"""Build a frozen native checkout using the existing fleet signer and public backend configuration.

No enrollment password or signing secret is printed or put on command lines.
The reference APK must use the installed fleet certificate; only its public anon
API key is reused. Release source must be committed and clean under agent/.
"""
import argparse, base64, hashlib, json, os, re, shutil, subprocess, time, zipfile
from pathlib import Path

SIGNER='9f83efe0a3d3399f899619ef35eb43df4f51f8c61e237bf1b547dce3482eaa79'
REPO=Path(__file__).resolve().parents[2]
SDK=Path(os.environ['LOCALAPPDATA'])/'Android/Sdk/build-tools/35.0.0'

def require(condition,message):
    if not condition:raise RuntimeError(message)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,required=True);parser.add_argument('--reference',type=Path,required=True);parser.add_argument('--code',type=int,required=True);parser.add_argument('--version',required=True);args=parser.parse_args()
    require(not subprocess.check_output(['git','status','--porcelain','--','agent'],cwd=args.source,text=True).strip(),'Native source must be committed and clean')
    env=os.environ.copy();env['JAVA_HOME']='C:/Program Files/Android/Android Studio/jbr'
    cert=subprocess.run([str(SDK/'apksigner.bat'),'verify','--print-certs',str(args.reference)],capture_output=True,text=True,env=env)
    require(cert.returncode==0 and re.findall(r'Signer #\d+ certificate SHA-256 digest: (\w+)',cert.stdout)==[SIGNER],'Reference APK does not use installed fleet signer')
    keys=set()
    with zipfile.ZipFile(args.reference) as archive:
        require(archive.testzip() is None,'Reference APK integrity failure')
        for name in archive.namelist():
            if not re.fullmatch(r'classes\d*\.dex',name):continue
            for token in re.findall(rb'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}',archive.read(name)):
                try:
                    segment=token.split(b'.')[1];claims=json.loads(base64.urlsafe_b64decode(segment+b'='*(-len(segment)%4)))
                    if claims.get('role')=='anon' and claims.get('iss')=='supabase' and claims.get('exp',0)>time.time():keys.add(token.decode())
                except (ValueError,UnicodeError):pass
    require(len(keys)==1,'Expected one valid public backend API key')
    env.update(AGENT_KEYSTORE_FILE=str(Path.home()/'.android/debug.keystore'),AGENT_KEYSTORE_PASSWORD='android',AGENT_KEY_ALIAS='androiddebugkey',AGENT_KEY_PASSWORD='android',PRIMESECURE_URL='https://api.robokorda.duckdns.org',PRIMESECURE_ANON_KEY=next(iter(keys)),AGENT_VERSION_CODE=str(args.code),AGENT_VERSION_NAME=args.version)
    log=REPO/'artifacts'/('build-'+args.version+'-native.log')
    with log.open('wb') as out:
        result=subprocess.run([str(args.source/'agent/gradlew.bat'),'assembleRelease','lintRelease','testReleaseUnitTest','--console=plain'],cwd=args.source/'agent',env=env,stdout=out,stderr=subprocess.STDOUT)
    require(result.returncode==0,'Native build failed; inspect '+str(log))
    target=REPO/'artifacts'/f'primesecure-{args.version}-{args.code}.apk'
    shutil.copy2(args.source/'agent/app/build/outputs/apk/release/app-release.apk',target)
    cert=subprocess.run([str(SDK/'apksigner.bat'),'verify','--verbose','--print-certs',str(target)],capture_output=True,text=True,env=env)
    require(cert.returncode==0 and re.findall(r'Signer #\d+ certificate SHA-256 digest: (\w+)',cert.stdout)==[SIGNER],'New APK signer mismatch')
    badging=subprocess.run([str(SDK/'aapt.exe'),'dump','badging',str(target)],capture_output=True,text=True,env=env)
    require(badging.returncode==0 and f"package: name='com.robokorda.primesecure' versionCode='{args.code}' versionName='{args.version}'" in badging.stdout,'New APK package/version mismatch')
    manifest=subprocess.run([str(SDK/'aapt.exe'),'dump','xmltree',str(target),'AndroidManifest.xml'],capture_output=True,text=True,env=env)
    require(manifest.returncode==0 and re.search(r'android:testOnly[^\r\n]*=\(type 0x12\)0x0\b',manifest.stdout),'APK must be non-test-only')
    require(not re.search(r'android:debuggable[^\r\n]*=\(type 0x12\)0xffffffff',manifest.stdout),'APK must not be debuggable')
    with zipfile.ZipFile(target) as archive:
        require(archive.testzip() is None,'New APK integrity failure')
        for source in (args.source/'agent/app/src/main/assets').rglob('*'):
            if source.is_file():require(archive.read('assets/'+source.relative_to(args.source/'agent/app/src/main/assets').as_posix())==source.read_bytes(),'Bundled asset differs from frozen source')
    report={'apk':str(target),'version_code':args.code,'version_name':args.version,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size,'signer':SIGNER,'signature_verified':True,'same_installed_fleet_signer':True,'test_only':False,'physical_device_verified':False,'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=args.source,text=True).strip()}
    (REPO/'artifacts'/('verification-'+args.version+'-native.json')).write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)

if __name__=='__main__':main()
