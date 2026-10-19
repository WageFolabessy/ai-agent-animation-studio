import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute project root, derived from this module's location rather than the
 * current working directory, so scripts and tests behave identically no matter
 * where they are launched from.
 */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Default directory for rendered videos. It is git-ignored and never holds frame images. */
export const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');
