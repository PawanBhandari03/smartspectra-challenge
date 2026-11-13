// Plain-text wording for results and My decisions. No DOM, so it can be tested in Node.

const fmt = (v, digits = 0) => (v == null ? '—' : v.toFixed(digits));

function verdictText(v) {
  switch (v.kind) {
    case 'lean':
      return {
        title: `Your body stayed calmer with "${v.calmerLabel}"`,
        note: `In both rounds your pulse was lower while imagining "${v.calmerLabel}" (by ${fmt(Math.abs(v.round1), 1)} and ${fmt(Math.abs(v.round2), 1)} bpm), `
          + `both beyond the normal wobble of a resting pulse (${fmt(v.threshold, 1)} bpm). A higher pulse for "${v.tenserLabel}" can mean tension or excitement: which was it?`,
      };
    case 'tooClose':
      return {
        title: 'Your body didn\'t pick a side',
        note: 'That is an answer too: neither option made your body clearly calmer or tenser than the other, so this choice '
          + 'is less about fear or comfort and more about what you value. '
          + (v.agree
            ? `Both rounds leaned the same way, but by less than ${fmt(v.threshold, 1)} bpm, which is within the normal wobble of a resting pulse.`
            : 'The two rounds pointed in opposite directions.')
          + ' The moments below show where your body did react.',
      };
    case 'notEnough':
      return { title: 'Not enough clear signal', note: 'At least one visit had too few reliable pulse readings. Better light on your face and staying still usually fix this.' };
    default:
      return { title: 'Partial results', note: 'The session ended before both options were visited twice.' };
  }
}

function clockText(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// How a recorded decision compares with what the body did. Only a clear lean can "match"; every other
// result is reported as the person's own call, never as right or wrong.
function choiceComparison(session, verdict) {
  const c = session.choice;
  if (!c) return '';
  if (c.optionIndex == null) return 'Still deciding. Come back when you have.';
  if (verdict.kind !== 'lean') return 'Your body didn\'t pick a side here, so this one was all you.';
  return c.optionIndex === verdict.calmerIndex
    ? 'This matches the option your body was calmer with.'
    : 'Your body was calmer with the other option. A higher pulse can mean excitement as well as tension.';
}

// Session file names carry their start time, e.g. gutcheck-2026-11-12T03-25-50-740Z.json.
function sessionWhen(name) {
  const m = name.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
}

module.exports = { verdictText, choiceComparison, clockText, sessionWhen };
