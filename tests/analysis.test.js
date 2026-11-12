const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { analyzeSession, pulseTrace, MIN_ROUND_GAP_BPM } = require('../src/core/analysis');
const { abbaSession } = require('./helpers');

const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'samples', 'beach-vs-speech', 'session.json'), 'utf8'));

test('real positive control (bundled sample): the beach is calmer in both rounds', () => {
  const { verdict } = analyzeSession(sample);
  assert.equal(verdict.kind, 'lean');
  assert.equal(verdict.calmerIndex, 0);
  assert.match(verdict.calmerLabel, /beach/);
  assert.ok(verdict.round1 < -MIN_ROUND_GAP_BPM && verdict.round2 < -MIN_ROUND_GAP_BPM);
});

test('noise only (same pulse for both options) is "too close to call"', () => {
  const { verdict } = analyzeSession(abbaSession([70, 71, 70, 71]));
  assert.equal(verdict.kind, 'tooClose');
});

test('a consistent but small gap stays below the 6 bpm floor', () => {
  // Like the tea-vs-coffee control: one option ~4 bpm lower in both rounds.
  const { verdict } = analyzeSession(abbaSession([62, 66, 67, 63]));
  assert.equal(verdict.kind, 'tooClose');
  assert.equal(verdict.agree, true);
});

test('a large gap in both rounds names the calmer option', () => {
  const { verdict } = analyzeSession(abbaSession([65, 76, 77, 66]));
  assert.equal(verdict.kind, 'lean');
  assert.equal(verdict.calmerIndex, 0);
});

test('rounds pointing in opposite directions are "too close to call"', () => {
  const { verdict } = analyzeSession(abbaSession([60, 72, 64, 75]));
  assert.equal(verdict.kind, 'tooClose');
  assert.equal(verdict.agree, false);
});

test('too few reliable readings in a visit gives "not enough signal"', () => {
  const { verdict } = analyzeSession(abbaSession([65, 76, 77, 66], { readingsPerVisit: 4 }));
  assert.equal(verdict.kind, 'notEnough');
});

test('low-confidence readings are ignored', () => {
  const { verdict } = analyzeSession(abbaSession([65, 76, 77, 66], { confidence: 20 }));
  assert.equal(verdict.kind, 'notEnough');
});

test('an unfinished session is "incomplete"', () => {
  const session = abbaSession([65, 76, 77, 66]);
  session.phases = session.phases.slice(0, -2);
  assert.equal(analyzeSession(session).verdict.kind, 'incomplete');
});

test('readings right after a low-confidence stretch are dropped (SDK spike filter)', () => {
  const pulse = [];
  for (let t = 0; t < 10000; t += 1000) pulse.push({ t, v: 62, c: 90, s: true });
  // 6 s of low confidence, then a spike the SDK even marks as stable.
  for (let t = 10000; t < 16000; t += 1000) pulse.push({ t, v: 95, c: 10, s: false });
  for (let t = 16000; t < 24000; t += 1000) pulse.push({ t, v: 96, c: 85, s: true });
  for (let t = 26000; t < 40000; t += 1000) pulse.push({ t, v: 63, c: 90, s: true });
  const trace = pulseTrace({ series: { pulse } });
  assert.ok(trace.every((p) => p.v < 70), 'no spike values survive');
  assert.ok(trace.some((p) => p.t >= 26000), 'readings after the re-settle period are kept');
});

test('moments: a pulse rise right after a prompt is reported', () => {
  const session = abbaSession([70, 70, 70, 70]);
  const visit = session.phases.find((p) => p.kind === 'option');
  // Flat 70 before the second prompt, then 80 while it is on screen.
  const promptStart = visit.startMs + 10000;
  session.series.pulse = [];
  for (let t = visit.startMs; t < visit.endMs; t += 1000) {
    session.series.pulse.push({ t, v: t >= promptStart + 5000 ? 80 : 70, c: 90, s: true });
  }
  const { moments } = analyzeSession(session);
  assert.ok(moments.rises.length >= 1);
  assert.equal(moments.rises[0].prompt, 'p2');
  assert.ok(moments.rises[0].shift >= 8);
});
