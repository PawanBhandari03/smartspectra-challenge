const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

// Some editors/tools set ELECTRON_RUN_AS_NODE, which makes Electron start as plain Node with no app window.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.'], { cwd: path.join(__dirname, '..'), env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
