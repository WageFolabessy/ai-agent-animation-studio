import { BUNDLED_FONT_FAMILY } from '../../config/fonts.js';
import { assertValidSvgPolicy } from './svg-policy-validator.js';

export function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/=/g, '&#61;');
}

export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function fmt(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid non-finite number in SVG generation: ${n}`);
  }
  return n.toFixed(decimals);
}

export type PathCommand =
  | { cmd: 'M'; x: number; y: number }
  | { cmd: 'L'; x: number; y: number }
  | { cmd: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { cmd: 'Z' };

export type Paint = string | { gradientId: string };

export interface PathStyle {
  fill?: Paint;
  stroke?: {
    paint: Paint;
    width: number;
    lineJoin?: 'miter' | 'round' | 'bevel';
    lineCap?: 'butt' | 'round' | 'square';
  };
  opacity?: number;
}

export interface GradientStop {
  offset: number;
  color: string;
  opacity?: number;
}

export interface LinearGradientOptions {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  units?: 'userSpaceOnUse' | 'objectBoundingBox';
  stops: GradientStop[];
}

export interface RadialGradientOptions {
  cx: number;
  cy: number;
  r: number;
  fx?: number;
  fy?: number;
  units?: 'userSpaceOnUse' | 'objectBoundingBox';
  stops: GradientStop[];
}

export interface GroupAttributes {
  id?: string;
  transform?: string;
  opacity?: number;
}

export interface SvgBuilderOptions {
  width?: number;
  height?: number;
  backgroundColor?: string;
}

const ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function formatPaint(paint: Paint): string {
  if (typeof paint === 'string') {
    return escapeXmlAttr(paint);
  }
  if (!ID_REGEX.test(paint.gradientId)) {
    throw new Error(`Invalid gradient ID referenced in paint: "${paint.gradientId}"`);
  }
  return `url(#${paint.gradientId})`;
}

/**
 * Builds one frame of SVG markup in memory. All string attributes are escaped, and
 * `build()` validates the final markup against the SVG policy, which also covers raw
 * markup passed to `addDef()` / `addElement()`.
 */
export class SvgBuilder {
  private readonly defs: string[] = [];
  private readonly elements: string[] = [];
  private readonly defIds: Set<string> = new Set();
  private groupDepth = 0;
  private readonly width: number;
  private readonly height: number;
  private readonly backgroundColor: string;

  constructor(options: SvgBuilderOptions = {}) {
    this.width = options.width ?? 1920;
    this.height = options.height ?? 1080;
    this.backgroundColor = options.backgroundColor ?? '#000000';
  }

  private validateId(id: string): void {
    if (!ID_REGEX.test(id)) {
      throw new Error(`Invalid SVG ID: "${id}". Must match ${ID_REGEX}`);
    }
    if (this.defIds.has(id)) {
      throw new Error(`Duplicate SVG def ID: "${id}"`);
    }
    this.defIds.add(id);
  }

  private validateStops(stops: GradientStop[]): void {
    if (stops.length < 1) {
      throw new Error('Gradients must contain at least 1 stop');
    }
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      if (stop.offset < 0 || stop.offset > 1 || !Number.isFinite(stop.offset)) {
        throw new Error(`Gradient stop offset out of bounds [0, 1]: ${stop.offset}`);
      }
      if (i > 0 && stop.offset < stops[i - 1].offset) {
        throw new Error(
          `Gradient stop offsets must be non-decreasing (stop ${i} offset ${stop.offset} < previous ${stops[i - 1].offset})`
        );
      }
      if (stop.opacity !== undefined && (stop.opacity < 0 || stop.opacity > 1 || !Number.isFinite(stop.opacity))) {
        throw new Error(`Gradient stop opacity out of bounds [0, 1]: ${stop.opacity}`);
      }
    }
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

  public addLinearGradient(id: string, opts: LinearGradientOptions): this {
    this.validateId(id);
    this.validateStops(opts.stops);

    const units = opts.units ?? 'objectBoundingBox';
    const stopTags = opts.stops
      .map((s) => {
        const opacityAttr = s.opacity !== undefined ? ` stop-opacity="${fmt(s.opacity)}"` : '';
        return `<stop offset="${fmt(s.offset)}" stop-color="${escapeXmlAttr(s.color)}"${opacityAttr}/>`;
      })
      .join('');

    this.defs.push(
      `<linearGradient id="${id}" x1="${fmt(opts.x1)}" y1="${fmt(opts.y1)}" x2="${fmt(opts.x2)}" y2="${fmt(opts.y2)}" gradientUnits="${units}">${stopTags}</linearGradient>`
    );
    return this;
  }

  public addRadialGradient(id: string, opts: RadialGradientOptions): this {
    this.validateId(id);
    this.validateStops(opts.stops);
    if (opts.r <= 0 || !Number.isFinite(opts.r)) {
      throw new Error(`Radial gradient radius must be strictly positive: ${opts.r}`);
    }

    const units = opts.units ?? 'objectBoundingBox';
    const fxAttr = opts.fx !== undefined ? ` fx="${fmt(opts.fx)}"` : '';
    const fyAttr = opts.fy !== undefined ? ` fy="${fmt(opts.fy)}"` : '';
    const stopTags = opts.stops
      .map((s) => {
        const opacityAttr = s.opacity !== undefined ? ` stop-opacity="${fmt(s.opacity)}"` : '';
        return `<stop offset="${fmt(s.offset)}" stop-color="${escapeXmlAttr(s.color)}"${opacityAttr}/>`;
      })
      .join('');

    this.defs.push(
      `<radialGradient id="${id}" cx="${fmt(opts.cx)}" cy="${fmt(opts.cy)}" r="${fmt(opts.r)}"${fxAttr}${fyAttr} gradientUnits="${units}">${stopTags}</radialGradient>`
    );
    return this;
  }

  public beginGroup(attrs: GroupAttributes = {}): this {
    let markup = '<g';
    if (attrs.id) {
      if (!ID_REGEX.test(attrs.id)) {
        throw new Error(`Invalid group ID: "${attrs.id}"`);
      }
      markup += ` id="${attrs.id}"`;
    }
    if (attrs.transform) {
      markup += ` transform="${escapeXmlAttr(attrs.transform)}"`;
    }
    if (attrs.opacity !== undefined) {
      if (attrs.opacity < 0 || attrs.opacity > 1 || !Number.isFinite(attrs.opacity)) {
        throw new Error(`Group opacity out of bounds [0, 1]: ${attrs.opacity}`);
      }
      markup += ` opacity="${fmt(attrs.opacity)}"`;
    }
    markup += '>';
    this.elements.push(markup);
    this.groupDepth++;
    return this;
  }

  public endGroup(): this {
    if (this.groupDepth <= 0) {
      throw new Error('Unmatched endGroup() called without corresponding beginGroup()');
    }
    this.elements.push('</g>');
    this.groupDepth--;
    return this;
  }

  public addGroup(attrs: GroupAttributes, draw: (b: SvgBuilder) => void): this {
    this.beginGroup(attrs);
    draw(this);
    this.endGroup();
    return this;
  }

  public addPath(commands: readonly PathCommand[], style: PathStyle): this {
    if (commands.length === 0) {
      return this;
    }

    const d = commands
      .map((cmd) => {
        switch (cmd.cmd) {
          case 'M':
            return `M ${fmt(cmd.x)} ${fmt(cmd.y)}`;
          case 'L':
            return `L ${fmt(cmd.x)} ${fmt(cmd.y)}`;
          case 'C':
            return `C ${fmt(cmd.x1)} ${fmt(cmd.y1)} ${fmt(cmd.x2)} ${fmt(cmd.y2)} ${fmt(cmd.x)} ${fmt(cmd.y)}`;
          case 'Z':
            return 'Z';
        }
      })
      .join(' ');

    let attrs = `d="${d}"`;
    if (style.fill) {
      attrs += ` fill="${formatPaint(style.fill)}"`;
    } else {
      attrs += ' fill="none"';
    }

    if (style.stroke) {
      attrs += ` stroke="${formatPaint(style.stroke.paint)}" stroke-width="${fmt(style.stroke.width)}"`;
      if (style.stroke.lineJoin) {
        attrs += ` stroke-linejoin="${style.stroke.lineJoin}"`;
      }
      if (style.stroke.lineCap) {
        attrs += ` stroke-linecap="${style.stroke.lineCap}"`;
      }
    }

    if (style.opacity !== undefined) {
      attrs += ` opacity="${fmt(style.opacity)}"`;
    }

    this.elements.push(`<path ${attrs}/>`);
    return this;
  }

  public addRect(x: number, y: number, w: number, h: number, fill: string, opacity = 1): this {
    this.elements.push(
      `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" fill="${escapeXmlAttr(fill)}" opacity="${fmt(opacity)}"/>`
    );
    return this;
  }

  public addCircle(cx: number, cy: number, r: number, fill: string, opacity = 1): this {
    this.elements.push(
      `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="${escapeXmlAttr(fill)}" opacity="${fmt(opacity)}"/>`
    );
    return this;
  }

  public addLine(x1: number, y1: number, x2: number, y2: number, stroke: string, strokeWidth = 1, opacity = 1): this {
    this.elements.push(
      `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${escapeXmlAttr(stroke)}" stroke-width="${fmt(strokeWidth)}" opacity="${fmt(opacity)}"/>`
    );
    return this;
  }

  public addPolygon(
    points: ReadonlyArray<readonly [number, number]>,
    fill: string,
    stroke?: string,
    strokeWidth = 1,
    opacity = 1,
    shapeRendering?: 'optimizeSpeed' | 'geometricPrecision' | 'crispEdges'
  ): this {
    const pointList = points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ');
    const strokeAttrs = stroke ? ` stroke="${escapeXmlAttr(stroke)}" stroke-width="${fmt(strokeWidth)}"` : '';
    const renderingAttr = shapeRendering ? ` shape-rendering="${shapeRendering}"` : '';
    this.elements.push(
      `<polygon points="${pointList}" fill="${escapeXmlAttr(fill)}"${strokeAttrs} opacity="${fmt(opacity)}"${renderingAttr}/>`
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
      `<text x="${fmt(x)}" y="${fmt(y)}" font-size="${fmt(fontSize)}" font-family="${escapeXmlAttr(fontFamily)}" fill="${escapeXmlAttr(fill)}" text-anchor="${textAnchor}">${escapeXmlText(text)}</text>`
    );
    return this;
  }

  /** Returns the final SVG markup, throwing if it violates the SVG policy. */
  public build(): string {
    if (this.groupDepth !== 0) {
      throw new Error(`Unclosed SVG group: ${this.groupDepth} group(s) left unclosed`);
    }

    const defsBlock = this.defs.length > 0 ? `<defs>${this.defs.join('')}</defs>` : '';
    const background = `<rect width="100%" height="100%" fill="${escapeXmlAttr(this.backgroundColor)}"/>`;

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.width} ${this.height}" width="${this.width}" height="${this.height}">` +
      `${defsBlock}${background}${this.elements.join('')}</svg>`;

    assertValidSvgPolicy(svg);
    return svg;
  }
}
