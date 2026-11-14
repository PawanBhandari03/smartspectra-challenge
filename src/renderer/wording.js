// Plain-text wording for results and My decisions. No DOM, so it can be tested in Node.

const fmt = (v, digits = 0) => (v == null ? '—' : v.toFixed(digits));

// A tie can still have one big reaction. Single moments can be chance (the tea-vs-coffee control had one),
// so it is offered as a question, and only when it beats the same 6 bpm bar each round must clear.
const STANDOUT_BPM = 6;

// The question part of a prompt, without the option name it starts with.
function questionOf(prompt, label) {
  const i = prompt.indexOf(label);
  const rest = i >= 0 ? prompt.slice(i + label.length) : prompt;
  return rest.replace(/^[\s:.,-]+/, '').trim() || prompt;
}

function standoutMoment(moments) {
  const top = moments && moments.rises && moments.rises[0];
  return top && top.shift >= STANDOUT_BPM ? top : null;
}

// `moments` (optional, from analyzeSession) lets a tie lead with what did happen.
function verdictText(v, moments = null) {
  switch (v.kind) {
    case 'lean':
      return {
        title: `Your body stayed calmer with "${v.calmerLabel}"`,
        note: `In both rounds your pulse was lower while imagining "${v.calmerLabel}" (by ${fmt(Math.abs(v.round1), 1)} and ${fmt(Math.abs(v.round2), 1)} bpm), `
          + `both beyond the normal wobble of a resting pulse (${fmt(v.threshold, 1)} bpm). A higher pulse for "${v.tenserLabel}" can mean tension or excitement: which was it?`,
      };
    case 'tooClose': {
      const why = v.agree
        ? `Both rounds leaned the same way, but by less than ${fmt(v.threshold, 1)} bpm, which is within the normal wobble of a resting pulse.`
        : 'The two rounds pointed in opposite directions.';
      const m = standoutMoment(moments);
      if (m) {
        return {
          title: 'No clear winner, but one moment stood out',
          note: `Neither option kept you calmer in both rounds, so this choice is less about fear or comfort and more about what you value. ${why} `
            + `The biggest single jump came while you imagined "${m.label}" and read "${questionOf(m.prompt, m.label)}": your pulse rose about ${fmt(m.shift)} bpm. `
            + 'One moment can be chance, so treat it as a question, not an answer: what came up for you there?',
          moment: m,
        };
      }
      return {
        title: 'Your body didn\'t pick a side',
        note: 'That is an answer too: neither option made your body clearly calmer or tenser than the other, so this choice '
          + `is less about fear or comfort and more about what you value. ${why} The moments below show where your body did react.`,
      };
    }
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

// What to tell a person when the SDK can't run, in plain words. The raw SDK message stays in the session log.
// `codeName` is the SDK's error code name (e.g. 'kAuthenticationFailed'); anything unknown keeps the SDK text.
function friendlySdkError(codeName, message) {
  switch (codeName) {
    case 'kAuthenticationFailed':
      return 'Presage did not accept this API key. Check the key in Settings (top right), or try the sample, which needs no key.';
    case 'kCreditExhausted':
      return 'This Presage API key has run out of credits. Check your account at physiology.presagetech.com, or try the sample, which needs no credits.';
    case 'kNetworkError':
      return 'CrossRoads could not reach Presage to check the key. Check your internet connection and try again.';
    default:
      return `${message || 'Unknown error'}${codeName && codeName !== 'undefined' ? ` (${codeName})` : ''}`;
  }
}

module.exports = { friendlySdkError, verdictText, questionOf, STANDOUT_BPM, choiceComparison, clockText, sessionWhen };
