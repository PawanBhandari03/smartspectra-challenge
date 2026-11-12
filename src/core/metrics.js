// MetricType codes CrossRoads requests (values from @smartspectra/node-sdk MetricType).
// Landmarks (11) and the arterial pressure trace (16) are left out to keep processing light.
const REQUESTED_METRICS = [
  0,  // CHEST_BREATHING
  1,  // ABDOMEN_BREATHING
  2,  // BREATHING_RATE
  15, // PULSE_RATE
  17, // HRV
  12, // BLINKING
  14, // EXPRESSIONS
];

module.exports = { REQUESTED_METRICS };
