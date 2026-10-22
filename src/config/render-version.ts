import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Monotonically increasing render engine version.
 * Bump manually whenever the rendering logic, shader/projection math,
 * or compositor pipeline changes so cached chunks are invalidated.
 */
export const ENGINE_RENDER_VERSION = 5;

export const RENDER_AFFECTING_SRC_DIRS = [
  'engine',
  'schemas',
  'renderer',
  'config'
] as const;

export const EXEMPT_SRC_DIRS = [
  'agents',
  'diagnostics',
  'assets',
  'demo'
] as const;

/**
 * Computes a deterministic LF-normalized SHA-256 hash over all
 * render-affecting sources (src/engine, src/schemas, src/renderer, and src/config).
 */
export function computeRenderSourcesHash(baseDir = process.cwd()): string {
  const dirsToScan = RENDER_AFFECTING_SRC_DIRS.map((dir) => path.join(baseDir, 'src', dir));

  function getFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getFiles(fullPath));
      } else if (entry.isFile() && fullPath.endsWith('.ts')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const allFiles: string[] = [];
  for (const dir of dirsToScan) {
    allFiles.push(...getFiles(dir));
  }
  allFiles.sort();

  const hash = crypto.createHash('sha256');
  for (const file of allFiles) {
    const relPath = path.relative(baseDir, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    hash.update(`FILE:${relPath}\n`);
    hash.update(content);
    hash.update('\n');
  }

  return hash.digest('hex');
}

