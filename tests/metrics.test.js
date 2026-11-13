const test = require('node:test');
const assert = require('node:assert/strict');
const { MetricType } = require('@smartspectra/node-sdk');
const { REQUESTED_METRICS } = require('../src/core/metrics');

const name = (code) => Object.keys(MetricType).find((k) => MetricType[k] === code);

test('only the measurements CrossRoads uses are requested from the SDK', () => {
  assert.deepEqual(REQUESTED_METRICS.map(name).sort(), [
    'ABDOMEN_BREATHING', 'BLINKING', 'BREATHING_RATE', 'CHEST_BREATHING', 'EXPRESSIONS', 'HRV', 'PULSE_RATE',
  ]);
});

test('every requested code is a real SDK metric, listed once', () => {
  assert.ok(REQUESTED_METRICS.every((c) => name(c)), 'unknown metric code');
  assert.equal(new Set(REQUESTED_METRICS).size, REQUESTED_METRICS.length);
});

test('nothing beyond the session needs is requested (no landmarks, pressure trace or talking)', () => {
  for (const k of ['FACE_LANDMARKS', 'ARTERIAL_PRESSURE_TRACE', 'TALKING', 'EDA_TRACE']) {
    assert.ok(!REQUESTED_METRICS.includes(MetricType[k]), k);
  }
});
