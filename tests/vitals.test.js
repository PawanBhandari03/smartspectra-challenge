const test = require('node:test');
const assert = require('node:assert/strict');
const { Metrics } = require('@smartspectra/node-sdk/messages');
const { VitalsTracker, BlinkCounter, extractSample } = require('../src/core/vitals');

function packet(metrics) {
  return Metrics.encode(metrics).finish();
}

test('decodes pulse, breathing, HRV and expressions from an SDK packet', () => {
  const tracker = new VitalsTracker();
  tracker.ingest(packet({
    cardio: {
      pulseRate: [{ value: 72, confidence: 90, stable: true, timestamp: 1000 }],
      hrv: [{ rmssd: 45, sdnn: 50, meanNn: 830, baevsky: 0.6, confidence: 70, stable: true, timestamp: 1000 }],
    },
    breathing: { rate: [{ value: 14.5, confidence: 70, stable: false, timestamp: 1000 }] },
    face: { expression: [{ stable: true, timestamp: 1000, scores: [{ type: 6, confidence: 92 }, { type: 7, confidence: 5 }] }] },
  }));
  assert.equal(tracker.pulse.value, 72);
  assert.equal(tracker.breathing.value, 14.5);
  assert.equal(tracker.hrv.rmssd, 45);
  assert.equal(tracker.expression.top, 'neutral');
  assert.ok(Math.abs(tracker.expression.topScore - 92) < 0.01);
});

test('blinks are counted once even when packets repeat earlier samples', () => {
  const counter = new BlinkCounter();
  const first = [[1, false], [2, true], [3, true], [4, false]].map(([ts, detected]) => ({ ts, detected }));
  const overlapping = [[3, true], [4, false], [5, true], [6, false]].map(([ts, detected]) => ({ ts, detected }));
  assert.equal(counter.feed(first), 1);
  assert.equal(counter.feed(overlapping), 1);
});

test('blink counting restarts cleanly after a replay loops', () => {
  const counter = new BlinkCounter();
  counter.feed([{ ts: 100, detected: true }, { ts: 101, detected: false }]);
  counter.reset();
  assert.equal(counter.feed([{ ts: 1, detected: true }]), 1);
});

test('an empty packet yields no values', () => {
  const s = extractSample(Metrics.decode(packet({})));
  assert.equal(s.pulse, null);
  assert.equal(s.breathing, null);
  assert.equal(s.expression, null);
  assert.deepEqual(s.blinking, []);
});
