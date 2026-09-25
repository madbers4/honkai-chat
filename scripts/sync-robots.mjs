import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit tracked sources only: no source PSDs, secrets, node_modules or local artifacts.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/sync-robots.mjs <robot-game-checkout>');
const files = execFileSync('git', ['ls-files', '-z', '--', 'src', 'public', 'shared', 'server', 'tests', 'scripts', 'index.html', 'vite.config.js',
  'docs/generated-voice-pack.md', 'docs/generated-voice-pack-analysis.json',
  'docs/DIO-SPOKEN-PACK.md', 'docs/JOTARO-SPOKEN-PACK.md',
  'docs/SPOKEN-RUNTIME.md', 'docs/SPOKEN-VOICE-SCRIPT.md'], { cwd: source, encoding: 'utf8' }).split('\0').filter(Boolean);
const destination = path.join(root, 'games/robots');
for (const file of files) {
  const target = path.join(destination, file);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(source, file), target);
}
const upstream = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
writeFileSync(path.join(destination, 'package.json'), JSON.stringify({
  name: '@honkai-chat/robots', version: upstream.version, private: true, type: 'module',
  scripts: { build: 'vite build --base=/robots/', test: 'node --test tests/*.test.js' },
  dependencies: upstream.dependencies, devDependencies: { vite: upstream.devDependencies.vite },
}, null, 2) + '\n');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
writeFileSync(path.join(destination, 'UPSTREAM.json'), JSON.stringify({ project: 'hsr-robots-battle', revision, mount: '/robots/' }, null, 2) + '\n');
console.log(`Copied ${files.length} tracked game files (${revision}).`);
