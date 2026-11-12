const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan, plannedDurationMs } = require('../src/core/session');

const options = [{ label: 'Stay', detail: '' }, { label: 'Move', detail: 'higher salary' }];

test('each option is visited twice in a mirrored order (A B B A or B A A B)', () => {
  for (const r of [0.1, 0.9]) {
    const plan = buildPlan(options, { rand: () => r });
    const visits = plan.phases.filter((p) => p.kind === 'option');
    assert.equal(visits.length, 4);
    const order = visits.map((p) => p.optionIndex);
    assert.deepEqual(order, [order[0], order[1], order[1], order[0]]);
    assert.notEqual(order[0], order[1]);
    assert.deepEqual(visits.map((p) => p.visit), [1, 1, 2, 2]);
  }
});

test('a fixed order is respected (used to replay saved sessions)', () => {
  const plan = buildPlan(options, { order: [1, 0, 0, 1] });
  assert.deepEqual(plan.phases.filter((p) => p.kind === 'option').map((p) => p.optionIndex), [1, 0, 0, 1]);
});

test('session starts with settle and a calm baseline, with resets between visits', () => {
  const kinds = buildPlan(options, { rand: () => 0.1 }).phases.map((p) => p.kind);
  assert.deepEqual(kinds, ['settle', 'baseline', 'option', 'reset', 'option', 'reset', 'option', 'reset', 'option']);
});

test('a session takes about 4 minutes', () => {
  const minutes = plannedDurationMs(buildPlan(options)) / 60000;
  assert.ok(minutes > 3.5 && minutes < 4.5, `planned ${minutes.toFixed(1)} min`);
});

test('every prompt slot is filled and each option prompt names the option', () => {
  const plan = buildPlan(options);
  for (const p of plan.phases.filter((ph) => ph.durationMs)) {
    assert.equal(p.prompts.length, p.durationMs / plan.timing.promptEveryMs);
  }
  for (const p of plan.phases.filter((ph) => ph.kind === 'option')) {
    assert.ok(p.prompts.every((text) => text.includes(options[p.optionIndex].label)));
  }
});

test('the optional detail is woven into the first visit', () => {
  const plan = buildPlan(options);
  const firstMove = plan.phases.find((p) => p.kind === 'option' && p.optionIndex === 1 && p.visit === 1);
  assert.ok(firstMove.prompts.some((text) => text.includes('higher salary')));
});

test('exactly two options are required', () => {
  assert.throws(() => buildPlan([options[0]]));
  assert.throws(() => buildPlan([...options, { label: 'Third' }]));
});
