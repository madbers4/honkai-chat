import { readFile } from 'node:fs/promises';
import { assetUrl } from '../src/app-paths.js';

const fixtureOrigin = 'http://robot-fixture.invalid';
const modelPath = new URL(assetUrl('/assets/automaton.glb'), fixtureOrigin).pathname;
let modelBytes;

/** Exercise production fetch/deadline/cache/GLTF parsing with the real GLB.
 * Only its HTTP response is local: embedded blob images and every other asset
 * still use the original fetch. The caller retains its existing pixel stubs. */
export async function withRobotAssetFixture(load) {
  modelBytes ??= readFile(new URL('../public/assets/automaton.glb', import.meta.url));
  const bytes = await modelBytes;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const url = new URL(input instanceof Request ? input.url : String(input), fixtureOrigin);
    if (url.pathname !== modelPath || !['http:', 'https:'].includes(url.protocol)) return originalFetch(input, options);
    options?.signal?.throwIfAborted();
    return Promise.resolve(new Response(bytes, { headers: { 'Content-Type': 'model/gltf-binary' } }));
  };
  try { return await load(); }
  finally { globalThis.fetch = originalFetch; }
}
