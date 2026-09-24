import { mkdir, writeFile } from 'node:fs/promises';
const base = new URL('../public/fonts/', import.meta.url);
await mkdir(base, { recursive: true });
const source = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;800&family=Manrope:wght@400..800&family=Oswald:wght@500..700&display=swap';
const response = await fetch(source, { headers: { 'User-Agent':'Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36' } });
if (!response.ok) throw new Error(`Font stylesheet: ${response.status}`);
let css = await response.text();
const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map(match => match[1]))];
for (let i = 0; i < urls.length; i++) {
  const url = urls[i], extension = new URL(url).pathname.split('.').pop();
  const filename = `belobog-font-${i}.${extension}`;
  const font = await fetch(url); if (!font.ok) throw new Error(`Font: ${font.status}`);
  await writeFile(new URL(filename, base), Buffer.from(await font.arrayBuffer()));
  css = css.replaceAll(url, `/fonts/${filename}`);
}
await writeFile(new URL('fonts.css', base), css);
for (const family of ['barlowcondensed','manrope','oswald']) {
  const license = await fetch(`https://raw.githubusercontent.com/google/fonts/main/ofl/${family}/OFL.txt`);
  if (license.ok) await writeFile(new URL(`${family}-OFL.txt`, base), await license.text());
}
console.log(`Vendored ${urls.length} fonts. The game no longer depends on Google Fonts at runtime.`);
