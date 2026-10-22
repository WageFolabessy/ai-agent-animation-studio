import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves an optional real asset path relative to the workspace root or assets/audio/.
 * Returns the absolute path if the file exists on disk, or null if absent.
 * This guarantees offline tests gracefully skip instead of failing or reading raw paths.
 */
export function optionalAsset(relativePath: string): string | null {
  const cwd = process.cwd();
  // 1. Direct path relative to workspace root
  const directPath = path.resolve(cwd, relativePath);
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  // 2. Fallback relative to assets/audio directory
  const audioAssetPath = path.resolve(cwd, 'assets', 'audio', relativePath);
  if (fs.existsSync(audioAssetPath)) {
    return audioAssetPath;
  }

  return null;
}
