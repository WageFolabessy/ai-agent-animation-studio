import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { BUNDLED_FONT_FAMILY, BUNDLED_FONT_PATH } from '../config/fonts.js';
import { assertValidSvgPolicy } from '../engine/compositor/svg-policy-validator.js';

export interface RasterizerOptions {
  width?: number;
  height?: number;
  /** Load operating-system fonts. Disabled by default so output is deterministic. */
  loadSystemFonts?: boolean;
  /** Font file to load. Defaults to the bundled DejaVu Sans font. */
  fontPath?: string;
  defaultFontFamily?: string;
}

/**
 * Rasterizes SVG markup to a raw RGBA buffer entirely in memory.
 *
 * Invariants:
 * - SVG markup is validated against the SVG policy before it reaches resvg.
 * - No frame image is ever written to disk.
 * - With `loadSystemFonts: false` (default) a missing font file is a constructor error, so
 *   text can never silently disappear from rendered frames.
 */
export class SvgRasterizer {
  private readonly width: number;
  private readonly height: number;
  private readonly loadSystemFonts: boolean;
  private readonly fontPath: string;
  private readonly defaultFontFamily: string;
  private readonly expectedBytes: number;

  constructor(options: RasterizerOptions = {}) {
    this.width = options.width ?? 1920;
    this.height = options.height ?? 1080;
    this.loadSystemFonts = options.loadSystemFonts ?? false;
    this.fontPath = options.fontPath ?? BUNDLED_FONT_PATH;
    this.defaultFontFamily = options.defaultFontFamily ?? BUNDLED_FONT_FAMILY;
    this.expectedBytes = this.width * this.height * 4;

    if (!this.loadSystemFonts && !fs.existsSync(this.fontPath)) {
      throw new Error(
        `Deterministic font file not found: "${this.fontPath}". ` +
          'SvgRasterizer requires a valid font file when loadSystemFonts is false.'
      );
    }
  }

  /**
   * Converts SVG markup to a raw 32-bit RGBA buffer in memory.
   *
   * @throws if the SVG violates the SVG policy or the output size does not match the viewport.
   */
  public rasterize(svgMarkup: string): Buffer {
    assertValidSvgPolicy(svgMarkup);

    const resvg = new Resvg(svgMarkup, {
      fitTo: { mode: 'width', value: this.width },
      font: {
        fontFiles: [this.fontPath],
        loadSystemFonts: this.loadSystemFonts,
        defaultFontFamily: this.defaultFontFamily
      }
    });

    const rawBuffer = resvg.render().pixels;

    if (rawBuffer.byteLength !== this.expectedBytes) {
      throw new Error(
        `Rasterization byte mismatch: expected ${this.expectedBytes} bytes, received ${rawBuffer.byteLength} bytes`
      );
    }

    return rawBuffer;
  }
}
