import { BUNDLED_FONT_FAMILY } from '../../config/fonts.js';
import { assertValidSvgPolicy } from './svg-policy-validator.js';

export function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeXmlAttr(value: string): string {
  return escapeXmlText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface SvgBuilderOptions {
  width?: number;
  height?: number;
  backgroundColor?: string;
}

/**
 * Builds one frame of SVG markup in memory. All string attributes are escaped, and
 * `build()` validates the final markup against the SVG policy, which also covers raw
 * markup passed to `addDef()` / `addElement()`.
 */
export class SvgBuilder {
  private readonly defs: string[] = [];
  private readonly elements: string[] = [];
  private readonly width: number;
  private readonly height: number;
  private readonly backgroundColor: string;

  constructor(options: SvgBuilderOptions = {}) {
    this.width = options.width ?? 1920;
    this.height = options.height ?? 1080;
    this.backgroundColor = options.backgroundColor ?? '#000000';
  }

  /** Adds raw markup inside `<defs>`. It is validated by `build()`. */
  public addDef(markup: string): this {
    this.defs.push(markup);
    return this;
  }

  /** Adds raw element markup. It is validated by `build()`. */
  public addElement(markup: string): this {
    this.elements.push(markup);
    return this;
  }

  public addRect(x: number, y: number, w: number, h: number, fill: string, opacity = 1): this {
    this.elements.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${escapeXmlAttr(fill)}" opacity="${opacity}"/>`
    );
    return this;
  }

  public addCircle(cx: number, cy: number, r: number, fill: string, opacity = 1): this {
    this.elements.push(
      `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${escapeXmlAttr(fill)}" opacity="${opacity}"/>`
    );
    return this;
  }

  public addLine(x1: number, y1: number, x2: number, y2: number, stroke: string, strokeWidth = 1, opacity = 1): this {
    this.elements.push(
      `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${escapeXmlAttr(stroke)}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`
    );
    return this;
  }

  public addPolygon(points: ReadonlyArray<readonly [number, number]>, fill: string, stroke?: string, strokeWidth = 1, opacity = 1): this {
    const pointList = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    const strokeAttrs = stroke ? ` stroke="${escapeXmlAttr(stroke)}" stroke-width="${strokeWidth}"` : '';
    this.elements.push(
      `<polygon points="${pointList}" fill="${escapeXmlAttr(fill)}"${strokeAttrs} opacity="${opacity}"/>`
    );
    return this;
  }

  /**
   * Adds a text element. Only the bundled font family is guaranteed to render, because
   * the rasterizer does not load system fonts; it is therefore the default.
   */
  public addText(
    text: string,
    x: number,
    y: number,
    fontSize = 24,
    fill = '#ffffff',
    fontFamily = BUNDLED_FONT_FAMILY,
    textAnchor: 'start' | 'middle' | 'end' = 'middle'
  ): this {
    this.elements.push(
      `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${fontSize}" font-family="${escapeXmlAttr(fontFamily)}" fill="${escapeXmlAttr(fill)}" text-anchor="${textAnchor}">${escapeXmlText(text)}</text>`
    );
    return this;
  }

  /** Returns the final SVG markup, throwing if it violates the SVG policy. */
  public build(): string {
    const defsBlock = this.defs.length > 0 ? `<defs>${this.defs.join('')}</defs>` : '';
    const background = `<rect width="100%" height="100%" fill="${escapeXmlAttr(this.backgroundColor)}"/>`;

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.width} ${this.height}" width="${this.width}" height="${this.height}">` +
      `${defsBlock}${background}${this.elements.join('')}</svg>`;

    assertValidSvgPolicy(svg);
    return svg;
  }
}
