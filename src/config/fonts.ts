import path from 'node:path';
import { PROJECT_ROOT } from './paths.js';

/**
 * Font family name of the bundled font. Text rendering never relies on system
 * fonts, so any `<text>` element must use this family (or the rasterizer default,
 * which is this family) to be visible in the output.
 */
export const BUNDLED_FONT_FAMILY = 'DejaVu Sans';

/** Absolute path of the bundled font file (see `src/assets/fonts/LICENSE-DejaVu.txt`). */
export const BUNDLED_FONT_PATH = path.join(PROJECT_ROOT, 'src', 'assets', 'fonts', 'DejaVuSans.ttf');
