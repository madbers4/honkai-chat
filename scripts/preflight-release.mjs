import { spawn } from 'node:child_process';
import { mkdtemp, symlink, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'festival-release-'));
const link = path.join(temp, 'current');
await symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir');
// Import from a wrapper, as PM2 does, rather than assuming the entry is argv[1].
const child = spawn(process.execPath, ['--input-type=module', '-e', 'await import(process.argv[1])', pathToFileURL(path.join(link, 'server/start.mjs')).href], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stderr.on('data', data => { output += data; });
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited before listening (${code}): ${output}`)); });
    child.stdout.on('data', data => {
      output += data;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const code = await new Promise((resolve, reject) => {
    const smoke = spawn(process.execPath, [path.join(root, 'scripts/smoke-host.mjs'), `http://127.0.0.1:${port}`], { stdio: 'inherit' });
    smoke.once('error', reject); smoke.once('exit', resolve);
  });
  if (code !== 0) throw new Error('Release smoke check failed');
} finally {
  const stopped = new Promise(resolve => { if (child.exitCode != null) resolve(); else child.once('exit', resolve); });
  child.kill(); await stopped;
  // Remove the link itself, never recursively descend into the source release.
  await rm(link, { force: true }); await rmdir(temp);
}
