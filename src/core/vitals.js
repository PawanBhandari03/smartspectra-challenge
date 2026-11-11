const { decodeMetrics } = require('@smartspectra/node-sdk/messages');

const EXPRESSION_NAMES = {
  1: 'angry', 2: 'contempt', 3: 'disgust', 4: 'fear',
  5: 'happy', 6: 'neutral', 7: 'sad', 8: 'surprise',
};

// protobufjs may hand back 64-bit timestamps as Long objects.
function toNum(v) {
  if (v == null) return null;
  return typeof v === 'object' ? Number(v.toString()) : Number(v);
}

function latestMeasurement(list) {
  const m = list && list.length ? list[list.length - 1] : null;
  if (!m) return null;
  return { value: m.value ?? null, confidence: m.confidence ?? 0, stable: !!m.stable, ts: toNum(m.timestamp) };
}

// Pulls the values Gut Check uses out of one decoded SDK packet.
function extractSample(m) {
  const hrvList = m.cardio?.hrv;
  const h = hrvList && hrvList.length ? hrvList[hrvList.length - 1] : null;
  const exprList = m.face?.expression;
  const e = exprList && exprList.length ? exprList[exprList.length - 1] : null;
  let expression = null;
  if (e) {
    const scores = {};
    for (const s of e.scores || []) {
      const name = EXPRESSION_NAMES[s.type];
      if (name) scores[name] = s.confidence ?? 0;
    }
    expression = { scores, stable: !!e.stable, ts: toNum(e.timestamp) };
  }
  return {
    pulse: latestMeasurement(m.cardio?.pulseRate),
    breathing: latestMeasurement(m.breathing?.rate),
    hrv: h ? {
      rmssd: h.rmssd ?? null, sdnn: h.sdnn ?? null, meanNn: h.meanNn ?? null,
      baevsky: h.baevsky ?? null, confidence: h.confidence ?? 0, stable: !!h.stable, ts: toNum(h.timestamp),
    } : null,
    expression,
    blinking: (m.face?.blinking || []).map((b) => ({ ts: toNum(b.timestamp), detected: !!b.detected })),
  };
}

// Counts open -> closed eye transitions, skipping samples already seen in earlier packets.
class BlinkCounter {
  constructor() { this.reset(); }

  reset() {
    this._eyesClosed = false;
    this._lastTs = -Infinity;
  }

  // Returns how many new blinks the samples contain.
  feed(samples) {
    let blinks = 0;
    for (const b of samples) {
      if (b.ts != null && b.ts <= this._lastTs) continue;
      if (b.ts != null) this._lastTs = b.ts;
      if (b.detected && !this._eyesClosed) blinks += 1;
      this._eyesClosed = b.detected;
    }
    return blinks;
  }
}

class VitalsTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.pulse = null;
    this.breathing = null;
    this.hrv = null;
    this.expression = null;
    this.blinkCount = 0;
    this.packets = 0;
    this.blinks = new BlinkCounter();
  }

  ingest(buf) {
    const s = extractSample(decodeMetrics(buf));
    this.packets += 1;
    if (s.pulse) this.pulse = s.pulse;
    if (s.breathing) this.breathing = s.breathing;
    if (s.hrv) this.hrv = s.hrv;
    if (s.expression) {
      const top = Object.entries(s.expression.scores).sort((a, b) => b[1] - a[1])[0];
      this.expression = { ...s.expression, top: top ? top[0] : null, topScore: top ? top[1] : 0 };
    }
    this.blinkCount += this.blinks.feed(s.blinking);
    return s;
  }
}

module.exports = { VitalsTracker, BlinkCounter, extractSample, EXPRESSION_NAMES };
