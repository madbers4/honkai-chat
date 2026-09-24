import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppPaths } from '../src/app-paths.js';

test('subfolder assets, socket and QR share one namespace', () => {
  const paths = createAppPaths('/robots/');
  assert.equal(paths.path('/assets/automaton.glb?v=4'), '/robots/assets/automaton.glb?v=4');
  assert.equal(paths.path('api/info'), '/robots/api/info');
  assert.equal(paths.socket('https://festival.example'), 'wss://festival.example/robots/ws');
  assert.equal(paths.socket('http://192.168.1.12:3001'), 'ws://192.168.1.12:3001/robots/ws');
  assert.equal(paths.invite('A&B', 'https://festival.example'), 'https://festival.example/robots/?room=A%26B');
  assert.equal(paths.invite('ABC', 'https://festival.example', 'https://tunnel.example/robots/'), 'https://tunnel.example/robots/?room=ABC');
});

test('standalone URLs retain the original root path', () => {
  const paths = createAppPaths();
  assert.equal(paths.base, '/');
  assert.equal(paths.path('api/info'), '/api/info');
  assert.equal(paths.socket('http://localhost:3000'), 'ws://localhost:3000/ws');
  assert.equal(paths.invite('ABC', 'http://localhost:3000'), 'http://localhost:3000/?room=ABC');
});
