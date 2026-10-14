import { generateKeyPairSync, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keyPath = process.env.PRIMESECURE_UI_SIGNING_KEY || join(homedir(), '.ssh', 'primesecure-ui-signing.pem');
const publicPath = join(root, 'agent/app/src/main/assets/ui-public-key.txt');
if (process.argv.includes('--init')) {
  if (existsSync(keyPath) || existsSync(publicPath)) throw Error('Signing keys already exist. Do not replace a fleet trust key.');
  const keys = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'der' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, keys.privateKey, { mode: 0o600 });
  writeFileSync(publicPath, keys.publicKey.toString('base64') + '\n');
  console.log('Created UI signing key outside the repository. Back it up securely.');
  process.exit(0);
}
const automatic = process.argv.includes('--auto');
if (automatic && process.env.VERCEL_ENV !== 'production') {
  console.log('Keeping the checked-in student UI for local and preview builds.');
  process.exit(0);
}
const version = automatic ? Math.floor((Date.now() - Date.UTC(2026,0,1))/1000) : Number(process.argv.find(a => /^\d+$/.test(a)));
if (!Number.isSafeInteger(version) || version < 1) throw Error('Usage: node scripts/publish-student-ui.mjs VERSION [--verify-only]');
const privateKey = process.env.PRIMESECURE_UI_SIGNING_PEM || readFileSync(keyPath);
const publicKey = createPublicKey({ key: Buffer.from(readFileSync(publicPath, 'utf8').trim(), 'base64'), format: 'der', type: 'spki' });
const files = Object.fromEntries(['index.html','workspace.js','workspace.css','primebook.png','robokorda.jpg'].map(name => {
  const bytes=readFileSync(join(root, 'agent/app/src/main/assets/student', name));
  const canonical=/\.(html|js|css)$/.test(name) ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n')) : bytes;
  return [name,canonical.toString('base64')];
}));
const payload = Buffer.from(JSON.stringify({ version, bridge: 1, files }));
const signature = sign('sha256', payload, privateKey);
if (!verify('sha256', payload, publicKey, signature)) throw Error('Private key does not match the APK trust key.');
const output = join(root, 'dashboard/public/student-ui/release.json');
if (existsSync(output)) {
  const previous = JSON.parse(Buffer.from(JSON.parse(readFileSync(output, 'utf8')).payload, 'base64'));
  if (version <= previous.version && !process.argv.includes('--verify-only')) throw Error('UI versions must increase. Publish a new version to roll back.');
}
if (!process.argv.includes('--verify-only')) {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ payload: payload.toString('base64'), signature: signature.toString('base64') }));
}
console.log(`Verified signed student UI ${version}; ${payload.length} bytes. ${process.argv.includes('--verify-only') ? 'No files changed.' : 'Commit and deploy to publish.'}`);
