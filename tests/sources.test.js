const test = require('node:test');
const assert = require('node:assert/strict');
const { ReplaySource } = require('../src/core/sources');

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const recording = [
  { type: 'meta', version: 1, camera: 'Test camera' },
  { t: 0, type: 'status', status: 2 },
  { t: 5, type: 'metrics', ts: 100, b64: b64([1, 2, 3]) },
  { t: 10, type: 'validation', code: 0, ts: 110, hint: '' },
  { t: 15, type: 'fps', sent: 30, dropped: 1 },
  { t: 20, type: 'end' },
].map((r) => JSON.stringify(r)).join('\n') + '\n';

function collect(source) {
  const seen = [];
  for (const e of ['processingStatus', 'metrics', 'validationStatus', 'fps', 'loop']) source.on(e, (...a) => seen.push([e, ...a]));
  return seen;
}

test('a recording replays its events in order, with metrics bytes restored', async () => {
  const source = new ReplaySource(recording, { speed: 1000 });
  assert.equal(source.meta.camera, 'Test camera');
  const seen = collect(source);
  await new Promise((resolve) => { source.on('ended', resolve); source.start(); });
  assert.deepEqual(seen.map((s) => s[0]), ['processingStatus', 'metrics', 'validationStatus', 'fps']);
  assert.deepEqual([...seen[1][1]], [1, 2, 3]);
  assert.deepEqual(seen[3].slice(1), [30, 1]);
});

test('a looping replay starts over and says so', async () => {
  const source = new ReplaySource(recording, { speed: 1000, loop: true });
  const seen = collect(source);
  await new Promise((resolve) => { source.on('loop', resolve); source.start(); });
  await source.stop();
  assert.ok(seen.some((s) => s[0] === 'loop'));
  assert.equal(source.running, false);
});

test('an empty recording ends right away', async () => {
  const source = new ReplaySource('', { loop: true });
  await new Promise((resolve) => { source.on('ended', resolve); source.start(); });
  assert.equal(source.durationMs, 0);
});
