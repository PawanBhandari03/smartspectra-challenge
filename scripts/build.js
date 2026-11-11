const esbuild = require('esbuild');
const path = require('path');

const root = path.join(__dirname, '..');

const page = (name) => esbuild.build({
  entryPoints: [path.join(root, `src/renderer/${name}.js`)],
  outfile: path.join(root, `dist/${name}.js`),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  sourcemap: 'inline',
  logLevel: 'warning',
});

Promise.all([
  page('app'),
  page('lab'),
  esbuild.build({
    entryPoints: [path.join(root, 'src/preload/preload.js')],
    outfile: path.join(root, 'dist/preload.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    logLevel: 'warning',
  }),
]).catch(() => process.exit(1));
