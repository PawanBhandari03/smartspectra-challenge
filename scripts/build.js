const esbuild = require('esbuild');
const path = require('path');

const root = path.join(__dirname, '..');

Promise.all([
  esbuild.build({
    entryPoints: [path.join(root, 'src/renderer/app.js')],
    outfile: path.join(root, 'dist/renderer.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    sourcemap: 'inline',
    logLevel: 'warning',
  }),
  // Sandboxed preloads can only require('electron'), so the SDK's preload
  // bridge has to be bundled in rather than required at runtime.
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
