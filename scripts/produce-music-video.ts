#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';

console.warn(
  '[DEPRECATION NOTICE] "scripts/produce-music-video.ts" is deprecated and will be removed in a future release. Use "scripts/studio.ts --produce" instead.'
);

const studioScript = path.resolve(import.meta.dirname, 'studio.ts');
const args = ['--expose-gc', studioScript, '--produce', ...process.argv.slice(2)];

const child = spawn(process.execPath, args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
