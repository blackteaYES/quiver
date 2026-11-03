import { spawn } from 'node:child_process';
import electron from 'electron';

// Engine tests need node:sqlite, which the bundled Electron Node (24) provides.
// The local Node 20 cannot load it, so run the suite inside the Electron binary.
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
delete env.VITE_DEV_SERVER_URL;

const child = spawn(
  electron,
  ['tests/engine-full.test.mjs', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env,
    cwd: process.cwd(),
  },
);

child.on('close', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
