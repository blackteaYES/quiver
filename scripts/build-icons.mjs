import { spawn } from 'node:child_process';
import electron from 'electron';

// Must run outside ELECTRON_RUN_AS_NODE so BrowserWindow and capturePage exist.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['scripts/render-icons.cjs'], {
  stdio: 'inherit',
  env,
});

child.on('close', (code) => process.exit(code ?? 0));
