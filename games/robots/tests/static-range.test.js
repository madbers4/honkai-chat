import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';

const content = Buffer.from(Array.from({ length: 1024 }, (_, index) => index % 251));

for (const basePath of ['', '/robots']) {
  test(`static audio byte ranges through ${basePath || '/'} hosting`, async t => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'belobog-range-'));
    const staticDir = path.join(fixture, 'dist');
    const publicDir = path.join(fixture, 'public');
    let app;
    t.after(async () => {
      await app?.close();
      assert.equal(path.dirname(fixture), path.resolve(tmpdir()));
      assert.ok(path.basename(fixture).startsWith('belobog-range-'));
      await rm(fixture, { recursive: true, force: true });
    });
    for (const dir of [staticDir, publicDir]) await mkdir(path.join(dir, 'assets', 'music'), { recursive: true });
    await writeFile(path.join(staticDir, 'assets', 'music', 'dist.mp3'), content);
    await writeFile(path.join(publicDir, 'assets', 'music', 'public.mp3'), content);
    await writeFile(path.join(publicDir, 'assets', 'music', 'empty.mp3'), '');
    app = await startServer({ port: 0, host: '127.0.0.1', autoTick: false, basePath, staticDir, publicDir });
    const origin = `http://127.0.0.1:${app.port}${basePath}/assets/music`;
    const request = (file, options) => fetch(`${origin}/${file}.mp3`, options);

    for (const file of ['dist', 'public']) {
      await t.test(`${file}: complete GET and HEAD describe the same audio`, async () => {
        for (const method of ['GET', 'HEAD']) {
          const response = await request(file, { method });
          assert.equal(response.status, 200);
          assert.equal(response.headers.get('accept-ranges'), 'bytes');
          assert.equal(response.headers.get('content-type'), 'audio/mpeg');
          assert.equal(response.headers.get('content-length'), String(content.length));
          assert.equal(response.headers.get('content-range'), null);
          assert.deepEqual(Buffer.from(await response.arrayBuffer()), method === 'HEAD' ? Buffer.alloc(0) : content);
        }
      });

      await t.test(`${file}: bounded, open-ended and suffix ranges return exact byte slices`, async () => {
        const cases = [
          ['bytes=0-0', 0, 0], ['bytes=111-222', 111, 222],
          ['bytes=1000-', 1000, 1023], ['bytes=-17', 1007, 1023],
          ['bytes=-2048', 0, 1023], ['bytes=1000-999999999999999999999999', 1000, 1023],
        ];
        for (const [range, start, end] of cases) {
          const response = await request(file, { headers: { Range: range } });
          assert.equal(response.status, 206, range);
          assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${content.length}`, range);
          assert.equal(response.headers.get('content-length'), String(end - start + 1), range);
          assert.equal(response.headers.get('accept-ranges'), 'bytes');
          assert.equal(response.headers.get('content-type'), 'audio/mpeg');
          assert.deepEqual(Buffer.from(await response.arrayBuffer()), content.subarray(start, end + 1), range);
        }
      });

      await t.test(`${file}: impossible ranges return empty 416 with current total length`, async () => {
        for (const range of ['bytes=1024-', 'bytes=999999999999999999999999-', 'bytes=32-7', 'bytes=-0', 'bytes=-']) {
          const response = await request(file, { headers: { Range: range } });
          assert.equal(response.status, 416, range);
          assert.equal(response.headers.get('content-range'), `bytes */${content.length}`);
          assert.equal(response.headers.get('content-length'), '0');
          assert.equal((await response.arrayBuffer()).byteLength, 0);
        }
      });
    }

    await t.test('HEAD ignores Range; unsupported/multipart requests do not truncate audio', async () => {
      const head = await request('dist', { method: 'HEAD', headers: { Range: 'bytes=1024-' } });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('content-length'), String(content.length));
      assert.equal(head.headers.get('content-range'), null);
      assert.equal((await head.arrayBuffer()).byteLength, 0);
      for (const range of ['seconds=1-2', 'bytes=0-1,8-9', 'bytes=garbage']) {
        const response = await request('dist', { headers: { Range: range } });
        assert.equal(response.status, 200, range);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), content);
      }
    });

    await t.test('unverifiable If-Range sends the complete file instead of mixing revisions', async () => {
      const response = await request('public', { headers: { Range: 'bytes=111-222', 'If-Range': '"stale-audio"' } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-range'), null);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), content);
    });

    await t.test('empty asset has no satisfiable byte range', async () => {
      const response = await request('empty', { headers: { Range: 'bytes=0-' } });
      assert.equal(response.status, 416);
      assert.equal(response.headers.get('content-range'), 'bytes */0');
      assert.equal((await response.arrayBuffer()).byteLength, 0);
    });
  });
}
