// Turns a saved session (see SessionRunner.finish) into per-visit numbers and a verdict. Plain
// function of the session JSON so it can be re-run on old sessions and tested in Node.
//
// What the first real sessions taught us (Nov 11, see OVERVIEW.md):
// - Pulse is the only signal steady enough to vote. Single readings swing ±10 bpm, so each visit
//   uses the median of stable, confident readings.
// - The body drifts during a session, so options are compared with each other in a mirrored order
//   (A B B A), never with the calm baseline (thinking about your life is always more arousing
//   than picturing a cup of tea).
// - Breathing (30 s lag) and blinks are shown, not voted. Expressions drift with posture/light,
//   so they are timeline-only. HRV never became reliable and is not used.

// The SDK reports rolling averages, so the start of each block still reflects the previous one.
const LAGS = { pulseSkipMs: 15000, breathingSkipMs: 30000 };
const MIN_CONFIDENCE = 50;
const MIN_PULSE_READINGS = 8;
// On fake A/B sessions cut from real recordings (labels meaningless), pulse medians of one-minute
// blocks differed by 6-9 bpm by chance. Each round must beat both this floor and the visit wobble.
const MIN_ROUND_GAP_BPM = 6;

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// After the signal drops out, the SDK's first readings can be wildly off (Nov 12: ~97 bpm for a few
// seconds in a person resting at ~62), so readings right after a gap are skipped while it re-settles.
const DROPOUT = { gapMs: 4000, resettleMs: 10000 };

function cleanReadings(points) {
  const ok = points.filter((p) => p.s && p.c >= MIN_CONFIDENCE);
  const out = [];
  let resumeAt = -Infinity;
  ok.forEach((p, i) => {
    if (i > 0 && p.t - ok[i - 1].t > DROPOUT.gapMs) resumeAt = p.t + DROPOUT.resettleMs;
    if (p.t >= resumeAt) out.push(p);
  });
  return out;
}

const cleanCache = new WeakMap();
function clean(points) {
  if (!cleanCache.has(points)) cleanCache.set(points, cleanReadings(points));
  return cleanCache.get(points);
}

function reliable(points, start, end) {
  return clean(points).filter((p) => p.t >= start && p.t < end).map((p) => p.v);
}

function blockStats(series, block) {
  const pulse = reliable(series.pulse, block.startMs + LAGS.pulseSkipMs, block.endMs);
  const breathing = reliable(series.breathing, block.startMs + LAGS.breathingSkipMs, block.endMs);
  const minutes = (block.endMs - block.startMs) / 60000;
  return {
    pulse: median(pulse),
    pulseReadings: pulse.length,
    enoughSignal: pulse.length >= MIN_PULSE_READINGS,
    breathing: median(breathing),
    blinksPerMin: minutes > 0 ? series.blinks.filter((t) => t >= block.startMs && t < block.endMs).length / minutes : null,
  };
}

// verdict.kind:
//   'lean'          both rounds agree and the gap beats the visit-to-visit wobble
//   'tooClose'      rounds disagree, or the gap is within the wobble
//   'notEnough'     a visit had too little reliable signal
//   'incomplete'    the session didn't finish all four visits
function verdictFor(options, visits) {
  const byOption = [0, 1].map((i) => visits.filter((v) => v.optionIndex === i));
  if (byOption.some((v) => v.length < 2)) return { kind: 'incomplete' };
  if (visits.some((v) => !v.stats.enoughSignal)) return { kind: 'notEnough' };

  const [a1, a2] = byOption[0].map((v) => v.stats.pulse);
  const [b1, b2] = byOption[1].map((v) => v.stats.pulse);
  const round1 = a1 - b1;
  const round2 = a2 - b2;
  const gap = (round1 + round2) / 2;
  const wobble = (Math.abs(a1 - a2) + Math.abs(b1 - b2)) / 2;
  const agree = Math.sign(round1) === Math.sign(round2) && round1 !== 0;
  const threshold = Math.max(wobble, MIN_ROUND_GAP_BPM);
  const numbers = { round1, round2, gap, wobble, threshold };

  if (!agree || Math.min(Math.abs(round1), Math.abs(round2)) <= threshold) return { kind: 'tooClose', agree, ...numbers };
  // Lower pulse = calmer. "Calmer" is a description of the body, not a recommendation.
  const calmer = gap < 0 ? 0 : 1;
  return { kind: 'lean', calmerIndex: calmer, calmerLabel: options[calmer].label, tenserLabel: options[1 - calmer].label, agree, ...numbers };
}

// "Moments": how the pulse moved around each prompt, relative to just before it. The SDK's pulse
// is a ~12 s rolling average, so a reaction shows up a few seconds after the prompt appears.
// Moments are reflection cues, not proof: single moments sit inside normal pulse wobble.
const MOMENT = { reactionDelayMs: 5000, referenceMs: 10000, minReadings: 3, minShiftBpm: 3 };

function momentsFor(session) {
  const promptEvery = session.timing?.promptEveryMs;
  if (!promptEvery) return [];
  const out = [];
  for (const phase of session.phases) {
    if (phase.kind !== 'option' || phase.endMs == null || !phase.prompts) continue;
    phase.prompts.forEach((prompt, i) => {
      const start = phase.startMs + i * promptEvery;
      if (start >= phase.endMs) return;
      const end = Math.min(start + promptEvery, phase.endMs);
      const during = reliable(session.series.pulse, start + MOMENT.reactionDelayMs, end + MOMENT.reactionDelayMs);
      const before = reliable(session.series.pulse, start - MOMENT.referenceMs, start + 2000);
      if (during.length < MOMENT.minReadings || before.length < MOMENT.minReadings) return;
      out.push({
        prompt, optionIndex: phase.optionIndex, visit: phase.visit, startMs: start,
        label: session.options[phase.optionIndex].label,
        shift: median(during) - median(before),
      });
    });
  }
  return out;
}

function analyzeSession(session) {
  const { series } = session;
  const blocks = session.phases.filter((p) => p.endMs != null && p.kind !== 'settle' && p.kind !== 'reset');
  const baselineBlock = blocks.find((p) => p.kind === 'baseline');
  const visits = blocks
    .filter((p) => p.kind === 'option')
    .map((p) => ({ optionIndex: p.optionIndex, visit: p.visit, label: session.options[p.optionIndex].label, stats: blockStats(series, p) }));

  const options = session.options.map((o, i) => {
    const own = visits.filter((v) => v.optionIndex === i);
    const pulses = own.map((v) => v.stats.pulse).filter((p) => p != null);
    const blinks = own.map((v) => v.stats.blinksPerMin).filter((b) => b != null);
    return {
      label: o.label,
      visitPulses: own.map((v) => v.stats.pulse),
      pulse: pulses.length ? pulses.reduce((a, b) => a + b, 0) / pulses.length : null,
      blinksPerMin: blinks.length ? blinks.reduce((a, b) => a + b, 0) / blinks.length : null,
    };
  });

  const moments = momentsFor(session);
  const rises = moments.filter((m) => m.shift >= MOMENT.minShiftBpm).sort((a, b) => b.shift - a.shift).slice(0, 3);
  const calmest = moments.filter((m) => m.shift <= -MOMENT.minShiftBpm).sort((a, b) => a.shift - b.shift)[0] || null;

  return {
    baseline: baselineBlock ? blockStats(series, baselineBlock) : null,
    visits,
    options,
    moments: { rises, calmest, all: moments },
    verdict: session.version >= 2 ? verdictFor(session.options, visits) : { kind: 'incomplete' },
    completed: session.completed,
  };
}

// Reliable pulse readings for charting: [{ t, v }].
function pulseTrace(session) {
  return clean(session.series.pulse).map((p) => ({ t: p.t, v: p.v }));
}

module.exports = { analyzeSession, pulseTrace, LAGS, MIN_CONFIDENCE, MIN_PULSE_READINGS, MIN_ROUND_GAP_BPM, MOMENT };
