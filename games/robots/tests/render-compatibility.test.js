import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createReliableRenderer, supportsFloatTargets, guardShaderErrors, omitUnsupportedReflections, changedDrawingSize, checkRenderTarget, graphicsFailure, prepareWithGraphicsFallback } from '../src/render-compatibility.js';
import { arenaFailureMessage } from '../src/asset-loading.js';
import { compileArenaPrograms } from '../src/arena-warmup.js';

test('normal devices retain antialias and only a real context failure retries compatible attributes', () => {
  const calls = [], renderer = {};
  assert.equal(createReliableRenderer(options => { calls.push(options); return renderer; }), renderer);
  assert.equal(calls.length, 1); assert.equal(calls[0].antialias, true);
  calls.length = 0;
  assert.equal(createReliableRenderer(options => { calls.push(options); if (options.antialias) throw Error('driver rejects MSAA'); return renderer; }), renderer);
  assert.deepEqual(calls[1], { antialias: false, alpha: false, powerPreference: 'default' });
  assert.throws(() => createReliableRenderer(() => { throw Error('WebGL disabled'); }), error => error.kind === 'graphics');
});

test('float render-target capability probes the actual framebuffer and restores/disposes its allocation', () => {
  let complete = false, probes = 0, disposed = 0, target = { previous: true };
  const previous = target;
  const gl = { FRAMEBUFFER: 1, FRAMEBUFFER_COMPLETE: 2, isContextLost: () => false,
    checkFramebufferStatus: () => { probes++; return complete ? 2 : 3; } };
  const renderer = { extensions: { has: () => true }, getContext: () => gl, getRenderTarget: () => target,
    setRenderTarget(value) { target = value; if (value?.isWebGLRenderTarget) value.addEventListener('dispose', () => disposed++); } };
  assert.equal(supportsFloatTargets(renderer), false); assert.equal(target, previous); assert.equal(disposed, 1);
  complete = true;
  assert.equal(supportsFloatTargets(renderer), false); assert.equal(probes, 1, 'no GL sync query on each frame');
  assert.equal(supportsFloatTargets(renderer, true), true); assert.equal(probes, 2); assert.equal(disposed, 2);
  assert.equal(target, previous);
  complete = false; assert.throws(() => checkRenderTarget(renderer), error => error.kind === 'graphics');
});

test('absent float color extensions allocate nothing; half-float extension is sufficient for the probe', () => {
  let touched = false;
  const absent = { extensions: { has: () => false }, getContext: () => ({ checkFramebufferStatus() { touched = true; } }) };
  assert.equal(supportsFloatTargets(absent), false); assert.equal(touched, false);
  assert.equal(supportsFloatTargets({ extensions: { has: name => name === 'EXT_color_buffer_half_float' } }), true);
});

test('unsupported HDR reflections leave robot surface maps and geometry intact and do not affect supported devices', () => {
  const scene = new THREE.Scene(), map = new THREE.Texture(), env = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map, envMap: env, metalness: .8 });
  const geometry = new THREE.BoxGeometry(), mesh = new THREE.Mesh(geometry, material); scene.add(mesh);
  omitUnsupportedReflections(scene, true); assert.equal(material.envMap, env);
  omitUnsupportedReflections(scene, false);
  assert.equal(material.envMap, null); assert.equal(material.map, map); assert.equal(material.metalness, .8);
  assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material);
  geometry.dispose(); material.dispose(); map.dispose(); env.dispose();
});

test('driver shader errors become explicit graphics failures rather than a console-only ready state', async () => {
  const prior = () => {}, renderer = { debug: { onShaderError: prior } };
  const stop = guardShaderErrors(renderer);
  assert.throws(() => renderer.debug.onShaderError({ getProgramInfoLog: () => 'link failed', getShaderInfoLog: () => 'driver log' }, {}, {}, {}),
    error => error.kind === 'graphics' && error.code === 'GL_SHADER' && /link failed/.test(error.cause.message));
  stop(); assert.equal(renderer.debug.onShaderError, prior);
  await assert.rejects(compileArenaPrograms({ compile: () => new Set([{}]),
    properties: { get: () => ({ currentProgram: { isReady: () => true, diagnostics: { runnable: false } } }) } }, {}, {}), /драйвер/);
});

test('a dormant shader failure retries preparation once; abort, context loss and failed retry never loop or downgrade again', async () => {
  let calls = 0, retries = 0;
  const shader = graphicsFailure('GL_SHADER', 'shader');
  const result = await prepareWithGraphicsFallback(async () => { if (++calls === 1) throw shader; return 'prepared'; }, {
    canRetry: () => true, onRetry: error => { assert.equal(error, shader); retries++; },
  });
  assert.equal(result, 'prepared'); assert.equal(calls, 2); assert.equal(retries, 1);
  for (const [error, available] of [[Error('aborted'), true], [graphicsFailure('GL_CONTEXT', 'lost'), true], [shader, false]]) {
    calls = 0;
    await assert.rejects(prepareWithGraphicsFallback(async () => { calls++; throw error; }, {
      canRetry: () => available, onRetry: () => assert.fail('cancellation must not change quality'),
    }), expected => expected === error);
    assert.equal(calls, 1);
  }
  calls = retries = 0;
  await assert.rejects(prepareWithGraphicsFallback(async () => { calls++; throw shader; }, {
    canRetry: () => true, onRetry: () => { retries++; },
  }), error => error === shader);
  assert.equal(calls, 2); assert.equal(retries, 1);
  assert.match(arenaFailureMessage(shader), /GL_SHADER/);
  assert.ok(!arenaFailureMessage(shader).includes('driver log'));
});

test('the initial ResizeObserver echo does not invalidate an in-progress GPU preparation', () => {
  const previous = { width: 915, height: 412, pixelRatio: 2.2 };
  assert.equal(changedDrawingSize(previous, { ...previous }), false);
  assert.equal(changedDrawingSize(previous, { ...previous, pixelRatio: 2.2000000001 }), false);
  assert.equal(changedDrawingSize(previous, { ...previous, width: 412, height: 915 }), true);
  assert.equal(changedDrawingSize(previous, { ...previous, pixelRatio: 1.5 }), true);
});
