// Windows names phone cameras after their owner ("Pawan's S21 Ultra (Windows Virtual Camera)").
// The app still uses the real name to pick the device, but only shows and logs it without the
// owner's name, so it never appears in screenshots, logs or saved files.
function cameraLabel(name) {
  if (!name) return '';
  return String(name).replace(/^.+?['\u2019]s\s+/u, '').trim() || 'Camera';
}

module.exports = { cameraLabel };
