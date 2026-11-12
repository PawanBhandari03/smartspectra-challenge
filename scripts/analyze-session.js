// Prints the CrossRoads analysis of a saved session. Defaults to the bundled sample.
// Usage: npm run analyze [-- path/to/session.json]
const fs = require('fs');
const path = require('path');
const { analyzeSession, MIN_CONFIDENCE, MIN_PULSE_READINGS, MIN_ROUND_GAP_BPM } = require('../src/core/analysis');

const file = process.argv[2] || path.join(__dirname, '..', 'samples', 'beach-vs-speech', 'session.json');
const session = JSON.parse(fs.readFileSync(file, 'utf8'));
const a = analyzeSession(session);
const f = (v, d = 1) => (v == null ? '—' : v.toFixed(d));
const letter = (i) => 'AB'[i];

console.log(`Session: ${path.basename(file)}  (${session.createdAt})`);
session.options.forEach((o, i) => console.log(`  Option ${letter(i)}: ${o.label}`));
console.log(`  Visit order: ${session.order.map(letter).join(' ')}`);
console.log(`\nRules: stable readings with confidence >= ${MIN_CONFIDENCE}, >= ${MIN_PULSE_READINGS} per visit, each round must beat max(wobble, ${MIN_ROUND_GAP_BPM} bpm)\n`);

console.log('Visit  Option  Median pulse  Reliable readings');
for (const v of a.visits) {
  console.log(`  ${letter(v.optionIndex)}${v.visit}     ${letter(v.optionIndex)}       ${f(v.stats.pulse).padStart(6)} bpm   ${String(v.stats.pulseReadings).padStart(4)}`);
}

const v = a.verdict;
console.log('');
if (v.round1 != null) {
  console.log(`Round 1 (A - B): ${f(v.round1)} bpm`);
  console.log(`Round 2 (A - B): ${f(v.round2)} bpm`);
  console.log(`Wobble (same option, two visits): ${f(v.wobble)} bpm  ->  threshold ${f(v.threshold)} bpm`);
}
const verdicts = {
  lean: `Calmer with "${v.calmerLabel}"`,
  tooClose: "Didn't pick a side",
  notEnough: 'Not enough clear signal',
  incomplete: 'Incomplete session',
};
console.log(`\nVerdict: ${verdicts[v.kind]}`);
