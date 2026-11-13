// Pulse-over-time chart for the results screen: one line (reliable pulse readings), option visits
// as tinted background bands, numbered moment markers, and a crosshair tooltip that shows the
// prompt that was on screen at that time.

const SVG = 'http://www.w3.org/2000/svg';
// CSS colours for HTML (swatches, cards); the SVG chart reads the current theme's values when it draws.
const OPTION_COLORS = ['var(--opt-a)', 'var(--opt-b)'];
let OPT = ['#2f62a8', '#c8612e'];
let INK = '#1f1d1a';
let MUTED = '#847b6f';
let GRID = '#ebe3d6';
let SURFACE = '#fbf8f2';

function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  OPT = [v('--opt-a', OPT[0]), v('--opt-b', OPT[1])];
  INK = v('--ink', INK);
  MUTED = v('--muted', MUTED);
  GRID = v('--grid', GRID);
  SURFACE = v('--sheet', SURFACE);
}
const GAP_MS = 4000;

function el(name, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function shorten(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function promptAt(session, t) {
  const phase = session.phases.find((p) => p.endMs != null && t >= p.startMs && t < p.endMs);
  if (!phase) return { phase: null, prompt: '' };
  const every = session.timing?.promptEveryMs;
  const prompts = phase.prompts || [];
  const i = every ? Math.min(Math.floor((t - phase.startMs) / every), prompts.length - 1) : 0;
  return { phase, prompt: prompts[i] || '' };
}

function phaseName(session, phase) {
  if (!phase) return '';
  if (phase.kind === 'option') return `${session.options[phase.optionIndex].label} · visit ${phase.visit}`;
  return { baseline: 'Calm baseline', reset: 'Reset', settle: 'Getting ready' }[phase.kind] || phase.kind;
}

// Single readings swing ±10 bpm; a short rolling median shows the shape without inventing data.
const SMOOTH_MS = 3000;

function smooth(points, windowMs = SMOOTH_MS) {
  return points.map((p, i) => {
    const vals = [];
    for (let j = i; j >= 0 && p.t - points[j].t <= windowMs; j--) vals.push(points[j].v);
    for (let j = i + 1; j < points.length && points[j].t - p.t <= windowMs; j++) vals.push(points[j].v);
    vals.sort((a, b) => a - b);
    const mid = vals.length >> 1;
    return { t: p.t, v: vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2 };
  });
}

function renderTimeline(container, session, trace, highlights, medians = []) {
  readTheme();
  container.innerHTML = '';
  const start = session.phases.find((p) => p.kind === 'baseline')?.startMs ?? 0;
  const end = session.phases.reduce((m, p) => Math.max(m, p.endMs ?? 0), 0);
  const points = smooth(trace.filter((p) => p.t >= start && p.t <= end));
  if (points.length < 2 || end <= start) {
    container.textContent = 'Not enough reliable pulse readings to draw the timeline.';
    return;
  }

  const width = Math.max(560, container.clientWidth || 900);
  const height = 340;
  const m = { left: 44, right: 16, top: 34, bottom: 30 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  // Every reading the SDK sent (smoothed), drawn faintly so the session reads as one connected line.
  const raw = smooth((session.series.pulse || []).filter((p) => p.t >= start && p.t <= end && p.v > 30 && p.v < 200), 5000);
  const values = [...points.map((p) => p.v), ...medians.map((md) => md.v)];
  const rawVals = raw.map((p) => p.v);
  // Scale to the reliable readings, widened by at most 8 bpm for the faint line; beyond that it is clipped.
  const lo = Math.floor((Math.max(Math.min(...values) - 8, Math.min(...values, ...rawVals)) - 2) / 5) * 5;
  const hi = Math.ceil((Math.min(Math.max(...values) + 8, Math.max(...values, ...rawVals)) + 2) / 5) * 5;
  const x = (t) => m.left + ((t - start) / (end - start)) * plotW;
  const y = (v) => m.top + (1 - (v - lo) / (hi - lo)) * plotH;

  const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Pulse over the session' });

  // Phase bands
  for (const p of session.phases) {
    if (p.endMs == null || p.endMs <= start) continue;
    const x0 = x(Math.max(p.startMs, start));
    const x1 = x(p.endMs);
    if (p.kind === 'option') {
      el('rect', { x: x0, y: m.top, width: Math.max(0, x1 - x0), height: plotH, fill: OPT[p.optionIndex], 'fill-opacity': 0.08 }, svg);
      el('rect', { x: x0, y: m.top - 6, width: Math.max(0, x1 - x0), height: 4, rx: 2, fill: OPT[p.optionIndex] }, svg);
      const label = el('text', { x: x0 + 4, y: m.top - 12, fill: INK, 'font-size': 11 }, svg);
      label.textContent = `${shorten(session.options[p.optionIndex].label, Math.max(4, Math.floor((x1 - x0) / 7) - 3))} ${p.visit}`;
    } else if (p.kind === 'baseline') {
      const label = el('text', { x: x0 + 4, y: m.top - 12, fill: MUTED, 'font-size': 11 }, svg);
      label.textContent = 'Calm';
    }
  }

  // Grid + y ticks
  for (let v = lo; v <= hi; v += 5) {
    el('line', { x1: m.left, x2: width - m.right, y1: y(v), y2: y(v), stroke: GRID, 'stroke-width': 1 }, svg);
    const t = el('text', { x: m.left - 6, y: y(v) + 4, fill: MUTED, 'font-size': 11, 'text-anchor': 'end' }, svg);
    t.textContent = v;
  }
  const unit = el('text', { x: m.left - 6, y: m.top - 12, fill: MUTED, 'font-size': 11, 'text-anchor': 'end' }, svg);
  unit.textContent = 'bpm';

  // X ticks every 30 s of session time
  for (let t = 0; t <= end - start; t += 30000) {
    const tx = el('text', { x: x(start + t), y: height - 8, fill: MUTED, 'font-size': 11, 'text-anchor': 'middle' }, svg);
    tx.textContent = clock(t);
  }

  // Visit averages: the number each visit contributes, over the window that actually counts.
  for (const md of medians) {
    const x0 = x(Math.max(md.startMs, start));
    const x1 = x(md.endMs);
    el('line', { x1: x0, x2: x1, y1: y(md.v), y2: y(md.v), stroke: OPT[md.optionIndex], 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.9 }, svg);
    const lab = el('text', { x: x1 - 2, y: y(md.v) - 7, fill: OPT[md.optionIndex], 'font-size': 12, 'font-weight': 700, 'text-anchor': 'end' }, svg);
    lab.textContent = Math.round(md.v);
  }

  // Faint: all readings, including low-confidence ones that don't count. Bold: the reliable readings
  // the result is built from. The faint line is clipped to the chart so a camera glitch can't flatten it.
  const clipId = `plot-${Math.random().toString(36).slice(2, 8)}`;
  const clip = el('clipPath', { id: clipId }, el('defs', {}, svg));
  el('rect', { x: m.left, y: m.top, width: plotW, height: plotH }, clip);
  const line = (pts, gapMs) => pts.map((p, i) => `${i === 0 || p.t - pts[i - 1].t > gapMs ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  if (raw.length > 1) {
    el('path', { d: line(raw, 15000), fill: 'none', stroke: MUTED, 'stroke-width': 1.6, opacity: 0.55, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'clip-path': `url(#${clipId})` }, svg);
  }
  el('path', { d: line(points, GAP_MS), fill: 'none', stroke: INK, 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);

  // Numbered moment markers at the reaction (prompt start + delay)
  highlights.forEach((h, i) => {
    const t = h.t;
    const near = points.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), points[0]);
    el('circle', { cx: x(near.t), cy: y(near.v), r: 6, fill: SURFACE }, svg);
    el('circle', { cx: x(near.t), cy: y(near.v), r: 4.5, fill: INK }, svg);
    const n = el('text', { x: x(near.t), y: y(near.v) - 10, fill: INK, 'font-size': 11, 'font-weight': 700, 'text-anchor': 'middle' }, svg);
    n.textContent = h.label ?? String(i + 1);
  });

  // Hover layer
  const cross = el('line', { y1: m.top, y2: m.top + plotH, stroke: MUTED, 'stroke-width': 1, visibility: 'hidden' }, svg);
  const dot = el('circle', { r: 4.5, fill: INK, stroke: SURFACE, 'stroke-width': 2, visibility: 'hidden' }, svg);
  const hit = el('rect', { x: m.left, y: m.top, width: plotW, height: plotH, fill: 'transparent' }, svg);

  const tip = document.createElement('div');
  tip.className = 'chart-tip hidden';
  container.style.position = 'relative';
  container.append(svg, tip);

  hit.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const t = start + ((e.clientX - rect.left - m.left) / plotW) * (end - start);
    const p = points.reduce((best, q) => (Math.abs(q.t - t) < Math.abs(best.t - t) ? q : best), points[0]);
    const { phase, prompt } = promptAt(session, p.t);
    cross.setAttribute('x1', x(p.t));
    cross.setAttribute('x2', x(p.t));
    dot.setAttribute('cx', x(p.t));
    dot.setAttribute('cy', y(p.v));
    cross.setAttribute('visibility', 'visible');
    dot.setAttribute('visibility', 'visible');
    tip.innerHTML = '';
    const head = document.createElement('b');
    head.textContent = `${Math.round(p.v)} bpm · ${clock(p.t - start)}`;
    const where = document.createElement('div');
    where.textContent = phaseName(session, phase);
    tip.append(head, where);
    if (prompt) {
      const q = document.createElement('div');
      q.className = 'chart-tip-prompt';
      q.textContent = `“${prompt}”`;
      tip.append(q);
    }
    tip.classList.remove('hidden');
    const left = Math.min(x(p.t) + 12, width - 260);
    tip.style.left = `${left}px`;
    tip.style.top = `${m.top}px`;
  });
  hit.addEventListener('mouseleave', () => {
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    tip.classList.add('hidden');
  });
}

module.exports = { renderTimeline, OPTION_COLORS };
