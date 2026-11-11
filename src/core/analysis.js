// Turns a saved session (see SessionRunner.finish) into per-phase numbers. Plain function of the
// session JSON so it can be re-run on old sessions and tested in Node without the app.

// The SDK reports rolling averages (pulse ~12 s, breathing ~30 s), so the start of each phase
// still reflects the previous one. These windows skip that carry-over.
const DEFAULT_LAGS = { pulseSkipMs: 15000, breathingSkipMs: 30000, expressionSkipMs: 3000 };

const EXPRESSIONS = ['angry', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'];

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function inWindow(points, start, end) {
  return points.filter((p) => p.t >= start && p.t < end);
}

// Prefer stable readings; fall back to everything in the window if none were stable.
function measurementMean(points, start, end) {
  const all = inWindow(points, start, end);
  const stable = all.filter((p) => p.s);
  const used = stable.length ? stable : all;
  return { mean: mean(used.map((p) => p.v)), n: used.length, stableShare: all.length ? stable.length / all.length : 0 };
}

function phaseStats(session, phase, lags) {
  const { series } = session;
  const { startMs, endMs } = phase;
  const minutes = (endMs - startMs) / 60000;
  const exprPoints = inWindow(series.expression, startMs + lags.expressionSkipMs, endMs);
  const expression = {};
  for (const name of EXPRESSIONS) expression[name] = mean(exprPoints.map((p) => p.scores[name] ?? 0));
  return {
    pulse: measurementMean(series.pulse, startMs + lags.pulseSkipMs, endMs),
    breathing: measurementMean(series.breathing, startMs + lags.breathingSkipMs, endMs),
    blinksPerMin: minutes > 0 ? series.blinks.filter((t) => t >= startMs && t < endMs).length / minutes : null,
    expression,
    expressionSamples: exprPoints.length,
  };
}

function diff(a, b) {
  return a != null && b != null ? a - b : null;
}

function analyzeSession(session, lags = DEFAULT_LAGS) {
  const phases = session.phases
    .filter((p) => p.endMs != null && p.kind !== 'settle')
    .map((p) => ({ ...p, stats: phaseStats(session, p, lags) }));

  // Average the start and end baselines; this also evens out slow drift across the session.
  const baselines = phases.filter((p) => p.kind === 'baseline' || p.kind === 'endBaseline');
  const avg = (get) => mean(baselines.map(get).filter((v) => v != null));
  const baseline = {
    pulse: avg((p) => p.stats.pulse.mean),
    breathing: avg((p) => p.stats.breathing.mean),
    blinksPerMin: avg((p) => p.stats.blinksPerMin),
    expression: Object.fromEntries(EXPRESSIONS.map((e) => [e, avg((p) => p.stats.expression[e])])),
  };

  const options = phases
    .filter((p) => p.kind === 'option')
    .map((p) => ({
      optionIndex: p.optionIndex,
      label: session.options[p.optionIndex].label,
      stats: p.stats,
      change: {
        pulse: diff(p.stats.pulse.mean, baseline.pulse),
        breathing: diff(p.stats.breathing.mean, baseline.breathing),
        blinksPerMin: diff(p.stats.blinksPerMin, baseline.blinksPerMin),
        expression: Object.fromEntries(EXPRESSIONS.map((e) => [e, diff(p.stats.expression[e], baseline.expression[e])])),
      },
    }));

  const hrv = session.series.hrv.filter((h) => h.rmssd != null);
  const lastHrv = hrv.length ? hrv[hrv.length - 1] : null;

  return { baseline, phases, options, sessionHrv: lastHrv, completed: session.completed };
}

module.exports = { analyzeSession, DEFAULT_LAGS, EXPRESSIONS };
