import assert from 'node:assert/strict';
import { createPublicKey, verify, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const input=process.argv[2];
let releaseText;
if(input?.startsWith('https:')) {
  const response=await fetch(input,{redirect:'error'});
  assert(response.ok,`Release HTTP ${response.status}`);
  assert(response.headers.get('content-type')?.includes('application/json'),'Expected signed release JSON, not a login/protection page');
  releaseText=await response.text();
} else releaseText=readFileSync(input?resolve(input):join(root,'dashboard/public/student-ui/release.json'),'utf8');
const envelope=JSON.parse(releaseText);
const key=createPublicKey({key:Buffer.from(readFileSync(join(root,'agent/app/src/main/assets/ui-public-key.txt'),'utf8').trim(),'base64'),format:'der',type:'spki'});
const payload=Buffer.from(envelope.payload,'base64'), signature=Buffer.from(envelope.signature,'base64');
assert(verify('sha256',payload,key,signature),'Release signature failed');
const changed=Buffer.from(payload);changed[changed.length-2]^=1;
assert(!verify('sha256',changed,key,signature),'Tampered bundle accepted');
assert(!verify('sha256',payload,generateKeyPairSync('rsa',{modulusLength:2048}).publicKey,signature),'Wrong signer accepted');
const release=JSON.parse(payload);
assert.equal(release.bridge,1);
assert(Number.isSafeInteger(release.version)&&release.version>0&&release.version<=2147483647);
assert.deepEqual(Object.keys(release.files).sort(),['index.html','primebook.png','robokorda.jpg','workspace.css','workspace.js']);
for(const [name,bytes] of Object.entries(release.files)) {
  const actual=Buffer.from(bytes,'base64'), expected=readFileSync(join(root,'agent/app/src/main/assets/student',name));
  assert(/\.(html|js|css)$/.test(name)
    ? actual.toString('utf8').replace(/\r\n/g,'\n')===expected.toString('utf8').replace(/\r\n/g,'\n')
    : actual.equals(expected),`Published ${name} differs from source`);
}
console.log(JSON.stringify({version:release.version,signature:'PASS',tamperRejection:'PASS',wrongSignerRejection:'PASS',bridge:release.bridge,sourceParity:'PASS'}));
