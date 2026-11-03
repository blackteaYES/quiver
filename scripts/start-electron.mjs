import { spawn } from 'node:child_process';
import electron from 'electron';

// Some IDE/agent shells export ELECTRON_RUN_AS_NODE=1, which disables the
// Electron main process and leaves `app` undefined. Strip it for the child.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('close', (code) => process.exit(code ?? 0));
