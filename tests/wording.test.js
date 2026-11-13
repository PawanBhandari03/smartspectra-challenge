const test = require('node:test');
const assert = require('node:assert/strict');
const { verdictText, choiceComparison, clockText, sessionWhen } = require('../src/renderer/wording');

const lean = { kind: 'lean', calmerIndex: 0, calmerLabel: 'The beach', tenserLabel: 'The speech', round1: -8.5, round2: -11, threshold: 6 };

test('a clear lean names the calmer option and both round gaps', () => {
  const t = verdictText(lean);
  assert.match(t.title, /calmer with "The beach"/);
  assert.match(t.note, /8\.5 and 11\.0 bpm/);
  assert.match(t.note, /tension or excitement/, 'a higher pulse is never called simply "bad"');
});

test('"didn\'t pick a side" reads as an answer, for both kinds of tie', () => {
  for (const agree of [true, false]) {
    const t = verdictText({ kind: 'tooClose', agree, threshold: 6 });
    assert.match(t.title, /didn't pick a side/);
    assert.match(t.note, /^That is an answer too/);
    assert.match(t.note, agree ? /less than 6\.0 bpm/ : /opposite directions/);
  }
});

test('weak signal and unfinished sessions get their own wording', () => {
  assert.match(verdictText({ kind: 'notEnough' }).title, /Not enough clear signal/);
  assert.match(verdictText({ kind: 'incomplete' }).title, /Partial results/);
});

test('a saved decision is compared with the body, never judged', () => {
  const session = (optionIndex) => ({ choice: { optionIndex } });
  assert.equal(choiceComparison({}, lean), '');
  assert.match(choiceComparison(session(null), lean), /Still deciding/);
  assert.match(choiceComparison(session(0), lean), /matches/);
  assert.match(choiceComparison(session(1), lean), /excitement as well as tension/);
  assert.match(choiceComparison(session(1), { kind: 'tooClose' }), /all you/);
  for (const c of [null, 0, 1]) assert.doesNotMatch(choiceComparison(session(c), lean), /wrong|mistake|should/i);
});

test('session times are read from the file name', () => {
  const when = sessionWhen('gutcheck-2026-11-12T03-25-50-740Z.json');
  assert.equal(when.toISOString(), '2026-11-12T03:25:50.740Z');
  assert.equal(sessionWhen('notes.json'), null);
});

test('clock times are minutes and seconds', () => {
  assert.equal(clockText(0), '0:00');
  assert.equal(clockText(65400), '1:05');
  assert.equal(clockText(-5), '0:00');
});
