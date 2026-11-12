// Renders assets/icon.svg to the PNG used for the window/taskbar icon. Run: node scripts/make-icon.js
const sharp = require('sharp');
const path = require('path');

const assets = path.join(__dirname, '..', 'assets');

sharp(path.join(assets, 'icon.svg'), { density: 384 })
  .resize(512, 512)
  .png()
  .toFile(path.join(assets, 'icon.png'))
  .then(() => console.log('assets/icon.png written'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
