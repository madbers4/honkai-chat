import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { ArenaLoadError, assetDeadline, fetchRobotBuffer, retryableLoad, loadArenaAssets, arenaFailureMessage } from '../src/asset-loading.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const texture = () => ({ disposed: 0, dispose() { this.disposed++; } });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('stalled GLB headers abort, then one fresh retry preserves deployment path and version', async () => {
  const calls = [], data = new Uint8Array([1, 2, 3]);
  const buffer = await fetchRobotBuffer('/robots/assets/automaton.glb?v=signals-v4', { timeoutMs: 8,
    fetchImpl: (url, options) => {
      calls.push({ url, ...options });
      return calls.length === 1 ? new Promise(() => {}) : Promise.resolve(new Response(data));
    },
  });
  assert.deepEqual(new Uint8Array(buffer), data);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, false);
  const fresh = new URL(calls[1].url, 'https://club.example');
  assert.equal(fresh.pathname, '/robots/assets/automaton.glb');
  assert.equal(fresh.searchParams.get('v'), 'signals-v4');
  assert.ok(fresh.searchParams.get('_arenaRetry'));
  assert.equal(calls[1].cache, 'reload');
});

test('deadline includes a stalled response body and stops after two attempts', async () => {
  const signals = [];
  await assert.rejects(fetchRobotBuffer('/model.glb', { timeoutMs: 8, fetchImpl: async (_, { signal }) => {
    signals.push(signal); return { ok: true, arrayBuffer: () => new Promise(() => {}) };
  } }), error => error.kind === 'network');
  assert.equal(signals.length, 2);
  assert.ok(signals.every(signal => signal.aborted));
});

test('HTTP and network failures are recoverable, and repeated retry taps share one new boot', async () => {
  let requests = 0, starts = 0;
  const gate = deferred();
  const boot = retryableLoad(async () => {
    starts++;
    const bytes = await fetchRobotBuffer('/model.glb?v=7', { fetchImpl: async () => {
      requests++;
      if (requests <= 2) return new Response('', { status: 503 });
      await gate.promise; return new Response('recovered');
    } });
    return { bytes };
  });
  const first = boot();
  assert.equal(boot(), first);
  await assert.rejects(first, error => error.kind === 'network');
  const retry = boot();
  for (let tap = 0; tap < 20; tap++) assert.equal(boot(), retry);
  gate.resolve();
  const initialized = await retry;
  assert.equal(await boot(), initialized, 'successful arena instance is retained');
  assert.equal(starts, 2);
  assert.equal(requests, 3);
});

test('wallpaper falls back after its deadline; missing optional posters never block the arena', async () => {
  const primary = deferred(), poster = deferred(), fallback = texture(), lateWall = texture(), latePoster = texture();
  const assets = await loadArenaAssets({ robot: async () => {}, wallpaper: () => primary.promise,
    fallbackWallpaper: async () => fallback, posters: () => poster.promise, timeoutMs: 12, posterTimeoutMs: 5 });
  assert.equal(assets.wallpaper, fallback);
  assert.equal(assets.posterTexture, null);
  assert.equal(fallback.disposed, 0);
  primary.resolve(lateWall); poster.resolve(latePoster); await flush();
  assert.equal(lateWall.disposed, 1);
  assert.equal(latePoster.disposed, 1);
});

test('required model failure releases both already-resolved and late textures exactly once', async () => {
  const wall = texture(), poster = texture(), model = deferred(), delayedPoster = deferred();
  const assets = loadArenaAssets({ robot: () => model.promise, wallpaper: async () => wall,
    fallbackWallpaper: async () => assert.fail('unexpected fallback'), posters: () => delayedPoster.promise, timeoutMs: 500 });
  await flush(); model.reject(new ArenaLoadError('network', 'offline'));
  await assert.rejects(assets, error => error.kind === 'network');
  assert.equal(wall.disposed, 1);
  delayedPoster.resolve(poster); await flush();
  assert.equal(poster.disposed, 1);
});

test('failure of both wallpaper sources is required and disposes a successful poster', async () => {
  const poster = texture(), fallback = deferred();
  const assets = loadArenaAssets({ robot: async () => {}, wallpaper: async () => { throw Error('missing'); },
    fallbackWallpaper: () => fallback.promise, posters: async () => poster });
  await flush(); fallback.reject(Error('offline'));
  await assert.rejects(assets, error => error.kind === 'network');
  assert.equal(poster.disposed, 1);
});

test('successful texture loads preserve the original artwork and cancel their deadlines', async () => {
  const wall = texture(), poster = texture();
  const assets = await loadArenaAssets({ robot: async () => {}, wallpaper: async () => wall,
    fallbackWallpaper: async () => assert.fail('unexpected fallback'), posters: async () => poster, timeoutMs: 5, posterTimeoutMs: 5 });
  await new Promise(resolve => setTimeout(resolve, 12));
  assert.deepEqual(assets, { wallpaper: wall, posterTexture: poster });
  assert.equal(wall.disposed + poster.disposed, 0);
});

test('late rejected loads after deadline are handled and do not publish another result', async () => {
  const request = deferred();
  await assert.rejects(assetDeadline(() => request.promise, { timeoutMs: 5 }), error => error.kind === 'network');
  request.reject(new TypeError('late network rejection'));
  await flush();
});

test('network failure copy never claims a WebGL failure', () => {
  assert.match(arenaFailureMessage(new ArenaLoadError('network', 'timeout')), /соединение/);
  assert.doesNotMatch(arenaFailureMessage(new ArenaLoadError('network', 'timeout')), /WebGL/);
  assert.match(arenaFailureMessage(new ArenaLoadError('graphics', 'context')), /WebGL/);
  assert.match(arenaFailureMessage(new ArenaLoadError('model', 'decode')), /модель/);
  assert.doesNotMatch(arenaFailureMessage(Error('unknown')), /WebGL/);
});

test('the actual required GLB has no external downloads beyond its bounded fetch', async () => {
  const bytes = await fs.readFile(new URL('../public/assets/automaton.glb', import.meta.url));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert.ok(json.buffers.every(buffer => !buffer.uri));
  assert.ok(json.images.every(image => image.bufferView !== undefined && !image.uri));
  assert.equal(json.extensionsRequired?.length || 0, 0);
});

test('the real robot cache clears a failed promise, then parses and caches recovered GLB bytes', async t => {
  const saved = new Map(['fetch', 'self', 'createImageBitmap', 'ProgressEvent'].map(key => [key, globalThis[key]]));
  t.after(() => { for (const [key, value] of saved) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const bytes = await fs.readFile(new URL('../public/assets/automaton.glb', import.meta.url));
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
  globalThis.ProgressEvent = class { constructor(type, properties) { this.type = type; Object.assign(this, properties); } };
  let count = 0;
  globalThis.fetch = (url, options) => {
    if (!String(url).includes('/automaton.glb')) return saved.get('fetch')(url, options);
    count++;
    return Promise.resolve(count <= 2 ? new Response('', { status: 503 }) : new Response(bytes));
  };
  const { loadRobotAssets } = await import('../src/robot.js');
  await assert.rejects(loadRobotAssets(), error => error.kind === 'network');
  const [a, b] = await Promise.all([loadRobotAssets(), loadRobotAssets()]);
  assert.ok(a.isGroup);
  assert.equal(a, b);
  assert.equal(await loadRobotAssets(), a);
  assert.equal(count, 3);
});

test('a successful HTTP response with an invalid model is fetched fresh on manual recovery', async t => {
  const saved = new Map(['fetch', 'self', 'createImageBitmap', 'ProgressEvent'].map(key => [key, globalThis[key]]));
  t.after(() => { for (const [key, value] of saved) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const bytes = await fs.readFile(new URL('../public/assets/automaton.glb', import.meta.url));
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
  globalThis.ProgressEvent = class { constructor(type, properties) { this.type = type; Object.assign(this, properties); } };
  const calls = [];
  globalThis.fetch = (url, options) => {
    if (!String(url).includes('/automaton.glb')) return saved.get('fetch')(url, options);
    calls.push({ url, ...options });
    return Promise.resolve(new Response(calls.length === 1 ? 'not a model' : bytes));
  };
  const { loadRobotAssets } = await import('../src/robot.js?decode-recovery');
  await assert.rejects(loadRobotAssets(), error => error.kind === 'model');
  assert.ok((await loadRobotAssets()).isGroup);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cache, 'reload');
  assert.match(calls[1].url, /v=signals-v4&_arenaRetry=/);
});
