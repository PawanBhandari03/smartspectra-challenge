const test = require('node:test');
const assert = require('node:assert/strict');
const { cameraLabel } = require('../src/renderer/camera-name');

test('camera labels drop the owner name Windows adds to phone cameras', () => {
  assert.equal(cameraLabel("Pawan Singh's S21 Ultra (Windows Virtual Camera)"), 'S21 Ultra (Windows Virtual Camera)');
  assert.equal(cameraLabel('Alex\u2019s iPhone'), 'iPhone');
});

test('ordinary camera names are unchanged', () => {
  assert.equal(cameraLabel('USB2.0 HD UVC WebCam'), 'USB2.0 HD UVC WebCam');
  assert.equal(cameraLabel(''), '');
});
