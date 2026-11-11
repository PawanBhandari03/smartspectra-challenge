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
    this._eyesClosed = false;
    this._lastBlinkTs = -Infinity;
  }

  ingest(buf) {
    const m = decodeMetrics(buf);
    this.packets += 1;

    const pulse = latestMeasurement(m.cardio?.pulseRate);
    if (pulse) this.pulse = pulse;

    const breathing = latestMeasurement(m.breathing?.rate);
    if (breathing) this.breathing = breathing;

    const hrvList = m.cardio?.hrv;
    if (hrvList && hrvList.length) {
      const h = hrvList[hrvList.length - 1];
      this.hrv = {
        rmssd: h.rmssd ?? null, sdnn: h.sdnn ?? null, meanNn: h.meanNn ?? null,
        baevsky: h.baevsky ?? null, confidence: h.confidence ?? 0, stable: !!h.stable, ts: toNum(h.timestamp),
      };
    }

    const exprList = m.face?.expression;
    if (exprList && exprList.length) {
      const e = exprList[exprList.length - 1];
      const scores = {};
      for (const s of e.scores || []) {
        const name = EXPRESSION_NAMES[s.type];
        if (name) scores[name] = s.confidence ?? 0;
      }
      const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
      this.expression = { scores, top: top ? top[0] : null, topScore: top ? top[1] : 0, stable: !!e.stable };
    }

    // Count a blink on each open -> closed transition; skip samples already seen in earlier packets.
    for (const b of m.face?.blinking || []) {
      const ts = toNum(b.timestamp);
      if (ts != null && ts <= this._lastBlinkTs) continue;
      if (ts != null) this._lastBlinkTs = ts;
      if (b.detected && !this._eyesClosed) this.blinkCount += 1;
      this._eyesClosed = !!b.detected;
    }

    return m;
  }
}

module.exports = { VitalsTracker, EXPRESSION_NAMES };
