import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Build-only policy: this file and its vocabulary are never included in client/dist.
export const retiredStoryWords = /[а-яё]*(?:бомб|взрыв|взорв)[а-яё]*|\bbombs?\b/giu;

export function findRetiredStoryWords(text) {
  // Inspect both literal text and escaped JavaScript / HTML text.
  const decoded = text.replace(/\\u\{([\da-f]+)\}|\\u([\da-f]{4})|&#x([\da-f]+);|&#(\d+);/gi,
    (_, braced, fixed, hex, decimal) => String.fromCodePoint(decimal ? Number(decimal) : parseInt(braced || fixed || hex, 16)));
  return [...new Set(decoded.match(retiredStoryWords) ?? [])];
}

async function checkBuild(directory) {
  let checked = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { checked += await checkBuild(file); continue; }
    if (!/\.(?:html|js|css|json|map|svg|txt|xml|webmanifest)$/i.test(file)) continue;
    const matches = findRetiredStoryWords(await readFile(file, 'utf8'));
    if (matches.length) throw new Error(`Retired story wording in ${file}: ${matches.join(', ')}`);
    checked++;
  }
  return checked;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = await checkBuild(fileURLToPath(new URL('../client/dist/', import.meta.url)));
  if (!count) throw new Error('No story build files found');
  console.log(`Story copy check passed: ${count} delivered text files contain no retired wording.`);
}
