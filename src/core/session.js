const { decodeMetrics } = require('@smartspectra/node-sdk/messages');
const { extractSample, BlinkCounter } = require('./vitals');

const SESSION_VERSION = 1;
const RUNNING = 3; // ProcessingStatus.kRunning

const TIMING = {
  settleMinMs: 20000,
  settleWarnMs: 60000,
  baselineMs: 75000,
  optionMs: 75000,
  resetMs: 20000,
  endBaselineMs: 60000,
  promptEveryMs: 15000,
};

const MIN_FRAMES_PER_SEC = 25;

// The baseline uses the same kind of task as the options (reading + picturing a scene),
// so differences come from the choice, not from "staring" vs "imagining".
const BASELINE_PROMPTS = [
  'Let\'s start with something ordinary. Read each line silently and picture it.',
  'Picture your kitchen on a normal morning. Notice the light coming in.',
  'You fill a cup with water. Hear it pour.',
  'You wait for it to warm. Nothing to decide, nothing to do.',
  'You take a slow sip. Just an ordinary moment.',
];

const END_BASELINE_PROMPTS = [
  'One more ordinary moment. Keep reading silently.',
  'Picture walking down a quiet street you know well.',
  'Notice the sky, the sounds, the pace of your steps.',
  'Nothing to decide. Just walking.',
];

const RESET_PROMPTS = [
  'Let that go.',
  'Breathe normally. The next one is coming up.',
];

function optionPrompts(option) {
  return [
    `It's six months from now. You chose: ${option.label}.`,
    'Picture waking up on a Monday morning. Where are you? What do you see first?',
    option.detail
      ? `Remember: ${option.detail}. How does that shape your day?`
      : 'Think about your day. Who is around you? How do you spend your time?',
    'Now it\'s evening. How does your body feel? Tired, light, restless?',
    'Imagine telling someone close to you about this choice. What do you say?',
  ];
}

function shuffle(items, rand = Math.random) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// options: [{ label, detail }]. Option order is randomised so "first option nerves" don't favour one side.
function buildPlan(options, { timing = TIMING, rand = Math.random } = {}) {
  const order = shuffle(options.map((_, i) => i), rand);
  const phases = [
    { kind: 'settle', prompts: ['Getting your signal ready. Sit comfortably and face the screen.'] },
    { kind: 'baseline', durationMs: timing.baselineMs, prompts: BASELINE_PROMPTS },
  ];
  for (const idx of order) {
    phases.push({ kind: 'option', optionIndex: idx, durationMs: timing.optionMs, prompts: optionPrompts(options[idx]) });
    phases.push({ kind: 'reset', durationMs: timing.resetMs, prompts: RESET_PROMPTS });
  }
  phases.push({ kind: 'endBaseline', durationMs: timing.endBaselineMs, prompts: END_BASELINE_PROMPTS });
  return { options, order, timing, phases };
}

function plannedDurationMs(plan) {
  return plan.timing.settleMinMs + plan.phases.reduce((sum, p) => sum + (p.durationMs || 0), 0);
}

class Emitter {
  constructor() { this._handlers = {}; }
  on(event, fn) { (this._handlers[event] ||= []).push(fn); return this; }
  emit(event, ...args) { for (const fn of this._handlers[event] || []) fn(...args); }
}

// Walks through the plan's phases on its own clock (sped up in demo mode) and collects the raw
// time series. The clock starts when the SDK reports Running. Events:
//   phase(phase, index) · tick(state) · done(result)
class SessionRunner extends Emitter {
  constructor(plan, source, { speed = 1, demo = false } = {}) {
    super();
    this.plan = plan;
    this.source = source;
    this.speed = speed;
    this.demo = demo;
    this.phaseIndex = -1;
    this.phaseTimes = [];
    this.series = { pulse: [], breathing: [], hrv: [], expression: [], blinks: [], fps: [], validation: [] };
    this.lastValidation = null;
    this.blinkCounter = new BlinkCounter();
    this._t0 = null;
    this._last = { pulseTs: null, breathingTs: null, hrvTs: null, exprT: -Infinity };

    source.on('processingStatus', (status) => {
      if (status === RUNNING && this._t0 == null) this._begin();
    });
    source.on('metrics', (buf) => this._ingest(buf));
    source.on('validationStatus', (code) => {
      if (this._t0 == null) return;
      if (!this.lastValidation || this.lastValidation.code !== code) this.series.validation.push({ t: this.now(), code });
      this.lastValidation = { code, t: this.now() };
    });
    source.on('fps', (sent) => {
      if (this._t0 != null) this.series.fps.push({ t: this.now(), sent });
    });
    source.on('loop', () => this.blinkCounter.reset());
  }

  now() {
    return this._t0 == null ? 0 : Math.round((performance.now() - this._t0) * this.speed);
  }

  get phase() {
    return this.plan.phases[this.phaseIndex];
  }

  _begin() {
    this._t0 = performance.now();
    this._enter(0);
    this._timer = setInterval(() => this._tick(), 200);
  }

  _enter(index) {
    const t = this.now();
    if (this.phaseIndex >= 0) this.phaseTimes[this.phaseIndex].endMs = t;
    this.phaseIndex = index;
    const p = this.phase;
    this.phaseTimes[index] = { kind: p.kind, optionIndex: p.optionIndex ?? null, startMs: t, endMs: null };
    this.source.mark?.({ event: 'phase', kind: p.kind, optionIndex: p.optionIndex ?? null, index });
    this.emit('phase', p, index);
  }

  // Signal is good enough to start the baseline: steady frames, face OK, pulse found.
  readiness() {
    const recentFps = this.series.fps.slice(-3);
    const framesOk = recentFps.length === 3 && recentFps.every((f) => f.sent >= MIN_FRAMES_PER_SEC);
    const faceOk = !!this.lastValidation && this.lastValidation.code === 0 && this.now() - this.lastValidation.t < 3000;
    const pulseOk = this.series.pulse.length > 0;
    return { framesOk, faceOk, pulseOk, ready: framesOk && faceOk && pulseOk };
  }

  _tick() {
    const p = this.phase;
    const elapsed = this.now() - this.phaseTimes[this.phaseIndex].startMs;
    let readiness = null;

    if (p.kind === 'settle') {
      readiness = this.readiness();
      if (elapsed >= this.plan.timing.settleMinMs && readiness.ready) {
        this._enter(this.phaseIndex + 1);
        return;
      }
    } else if (elapsed >= p.durationMs) {
      if (this.phaseIndex === this.plan.phases.length - 1) {
        this.finish();
        return;
      }
      this._enter(this.phaseIndex + 1);
      return;
    }

    const promptIndex = Math.min(Math.floor(elapsed / this.plan.timing.promptEveryMs), p.prompts.length - 1);
    this.emit('tick', {
      phase: p,
      phaseIndex: this.phaseIndex,
      elapsedMs: elapsed,
      remainingMs: p.durationMs ? Math.max(0, p.durationMs - elapsed) : null,
      prompt: p.prompts[promptIndex],
      readiness,
      settleTooLong: p.kind === 'settle' && elapsed >= this.plan.timing.settleWarnMs,
      validationCode: this.lastValidation?.code ?? null,
    });
  }

  _ingest(buf) {
    if (this._t0 == null) return;
    let s;
    try {
      s = extractSample(decodeMetrics(buf));
    } catch {
      return;
    }
    const t = this.now();
    const L = this._last;
    // Store each SDK measurement once (packets repeat the latest value), expressions at most 5x per second.
    if (s.pulse && s.pulse.value != null && s.pulse.ts !== L.pulseTs) {
      L.pulseTs = s.pulse.ts;
      this.series.pulse.push({ t, v: s.pulse.value, c: s.pulse.confidence, s: s.pulse.stable });
    }
    if (s.breathing && s.breathing.value != null && s.breathing.ts !== L.breathingTs) {
      L.breathingTs = s.breathing.ts;
      this.series.breathing.push({ t, v: s.breathing.value, c: s.breathing.confidence, s: s.breathing.stable });
    }
    if (s.hrv && s.hrv.ts !== L.hrvTs) {
      L.hrvTs = s.hrv.ts;
      this.series.hrv.push({ t, rmssd: s.hrv.rmssd, sdnn: s.hrv.sdnn, baevsky: s.hrv.baevsky, c: s.hrv.confidence, s: s.hrv.stable });
    }
    if (s.expression && t - L.exprT >= 200) {
      L.exprT = t;
      this.series.expression.push({ t, scores: s.expression.scores });
    }
    const blinks = this.blinkCounter.feed(s.blinking);
    for (let i = 0; i < blinks; i++) this.series.blinks.push(t);
  }

  finish() {
    if (this.result) return this.result;
    clearInterval(this._timer);
    if (this.phaseIndex >= 0 && this.phaseTimes[this.phaseIndex].endMs == null) {
      this.phaseTimes[this.phaseIndex].endMs = this.now();
    }
    const completed = this.phaseIndex === this.plan.phases.length - 1;
    this.result = {
      version: SESSION_VERSION,
      createdAt: new Date().toISOString(),
      demo: this.demo,
      completed,
      options: this.plan.options,
      order: this.plan.order,
      timing: this.plan.timing,
      phases: this.phaseTimes,
      series: this.series,
    };
    this.emit('done', this.result);
    return this.result;
  }

  abort() {
    if (this._t0 == null) return null;
    return this.finish();
  }
}

module.exports = { buildPlan, plannedDurationMs, SessionRunner, TIMING };
