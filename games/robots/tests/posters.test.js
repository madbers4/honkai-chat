import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createPaperPosters, loadPosterAtlas, POSTER_PLACEMENTS } from '../src/posters.js';
import { POSTER_CATALOG, POSTER_ATLAS } from '../src/poster-catalog.js';

test('poster atlas retains source provenance and bounded, nonoverlapping image rectangles', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/posters/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.psd.layers.length, 1, 'the source PSD is truthfully reported as flattened');
  assert.equal(manifest.assets.filter(a => a.origin === 'web-game-capture').length, 7);
  for (const asset of manifest.assets) {
    const [x, y, w, h] = asset.atlasRect;
    assert.ok(x >= 0 && y >= 0 && x + w <= POSTER_ATLAS.size[0] && y + h <= POSTER_ATLAS.size[1]);
    assert.match(asset.sourceSha256, /^[0-9a-f]{64}$/);
    if (asset.origin === 'web-game-capture') assert.ok(asset.directUrl.startsWith('https://') && asset.sourcePage.startsWith('https://'));
    assert.deepEqual(POSTER_CATALOG[asset.id].rect, asset.atlasRect);
  }
  for (let i = 0; i < manifest.assets.length; i++) for (let j = i + 1; j < manifest.assets.length; j++) {
    const [ax, ay, aw, ah] = manifest.assets[i].atlasRect, [bx, by, bw, bh] = manifest.assets[j].atlasRect;
    assert.ok(ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay, 'each source has its own atlas rectangle');
  }
  assert.ok(fs.statSync(new URL('../public/assets/posters/belobog-posters.webp', import.meta.url)).size < 1_100_000);
});

test('pasted paper remains behind combat, preserves finite UVs and adds only three reusable draws', () => {
  const wall = createPaperPosters(new THREE.Texture());
  assert.equal(wall.group.children.length, 3);
  assert.equal(wall.group.userData.posterCount, POSTER_PLACEMENTS.length);
  for (const mesh of wall.group.children) {
    mesh.geometry.computeBoundingBox(); const bounds = mesh.geometry.boundingBox;
    assert.ok(bounds.min.z > -3.30 && bounds.max.z < -3.20, 'paper remains adhered to the original wall');
    assert.ok(bounds.min.y > .6 && bounds.max.y < 4.8);
    assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
    assert.ok(mesh.geometry.attributes.uv.array.every(x => x >= 0 && x <= 1));
    assert.equal(mesh.castShadow, false, 'no additional dynamic shadow-map casters');
  }
  const resources = new Set([wall.group.children[0].material.map]);
  for (const mesh of wall.group.children) { resources.add(mesh.geometry); resources.add(mesh.material); }
  let count = 0; for (const resource of resources) resource.addEventListener('dispose', () => count++);
  wall.dispose(); wall.dispose();
  assert.equal(count, resources.size, 'all owned resources disposed exactly once');
});

test('optional poster loading is one bounded request and unavailable art never blocks the arena', async () => {
  let calls = 0; const texture = new THREE.Texture();
  assert.equal(await loadPosterAtlas({ async loadAsync(url) { calls++; assert.equal(url, POSTER_ATLAS.url); return texture; } }), texture);
  assert.equal(calls, 1); assert.equal(texture.colorSpace, THREE.SRGBColorSpace); assert.equal(texture.anisotropy, 4);
  assert.equal(await loadPosterAtlas({ async loadAsync() { throw new Error('offline'); } }), null);
  const empty = createPaperPosters(null); assert.equal(empty.group.children.length, 0); empty.dispose();
});
