// Builds synthetic sessions in the same shape SessionRunner saves, for testing the analysis.

const TIMING = { promptEveryMs: 10000 };

// visitPulses: pulse level for each of the 4 visits, in time order. order: optionIndex per visit.
// visitBreaths (optional): breathing rate for each visit, read in the visit's last 10 s.
function abbaSession(visitPulses, { order = [0, 1, 1, 0], readingsPerVisit = 25, confidence = 80, jitter = 1, visitBreaths = null } = {}) {
  const phases = [
    { kind: 'settle', optionIndex: null, visit: null, startMs: 0, endMs: 15000 },
    { kind: 'baseline', optionIndex: null, visit: null, startMs: 15000, endMs: 45000, prompts: ['calm'] },
  ];
  const pulse = [];
  const breathing = [];
  const visitCount = [0, 0];
  let t = 45000;
  order.forEach((optionIndex, n) => {
    if (n > 0) {
      phases.push({ kind: 'reset', optionIndex: null, visit: null, startMs: t, endMs: t + 10000 });
      t += 10000;
    }
    const start = t;
    const end = t + 40000;
    phases.push({
      kind: 'option', optionIndex, visit: ++visitCount[optionIndex], startMs: start, endMs: end,
      prompts: ['p1', 'p2', 'p3', 'p4'],
    });
    // Readings spread over the visit after the 15 s pulse lag, with a small alternating wobble.
    for (let i = 0; i < readingsPerVisit; i++) {
      const offset = 15000 + Math.round((i * 24000) / readingsPerVisit);
      pulse.push({ t: start + offset, v: visitPulses[n] + (i % 2 ? jitter : -jitter), c: confidence, s: true });
    }
    if (visitBreaths) {
      for (let i = 0; i < 5; i++) breathing.push({ t: start + 31000 + i * 1500, v: visitBreaths[n], c: confidence, s: true });
    }
    t = end;
  });
  return {
    version: 2,
    completed: true,
    options: [{ label: 'Option A' }, { label: 'Option B' }],
    order,
    timing: TIMING,
    phases,
    series: { pulse, breathing, hrv: [], expression: [], blinks: [], fps: [], validation: [] },
  };
}

module.exports = { abbaSession };
