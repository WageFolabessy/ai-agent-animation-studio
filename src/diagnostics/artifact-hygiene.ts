import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../config/paths.js';

/** Directory names that are never scanned (dependencies, VCS data, tooling state). */
const DEFAULT_IGNORED_DIRECTORIES: readonly string[] = ['node_modules', '.git', '.gemini'];

const TEMPORARY_IMAGE_PATTERN = /\.(png|svg)$/i;

/**
 * Recursively finds `.png` and `.svg` files, which indicate leaked temporary frame images
 * (the pipeline must render frames in memory only).
 *
 * Directories are skipped by exact name, not substring. Phase 2 bundled SVG assets must live
 * in a directory listed in `ignoredDirectories` or the check must be scoped to output folders.
 *
 * @param startDir Directory to scan. Defaults to the project root, independent of the CWD.
 * @throws if a directory cannot be read, so a scan can never silently report a clean result.
 */
export function findTemporaryImageFiles(
  startDir: string = PROJECT_ROOT,
  ignoredDirectories: readonly string[] = DEFAULT_IGNORED_DIRECTORIES
): string[] {
  const ignored = new Set(ignoredDirectories);
  const found: string[] = [];

  function scan(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      throw new Error(`Artifact hygiene scan failed to read directory "${dir}"`, { cause: err });
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) scan(fullPath);
      } else if (entry.isFile() && TEMPORARY_IMAGE_PATTERN.test(entry.name)) {
        found.push(fullPath);
      }
    }
  }

  if (fs.existsSync(startDir)) {
    scan(startDir);
  }
  return found;
}
