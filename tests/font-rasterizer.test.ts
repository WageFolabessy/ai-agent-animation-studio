import test from 'node:test';
import assert from 'node:assert/strict';
import { SvgRasterizer } from '../src/renderer/rasterizer.js';

test('Font Rasterizer: Renders bundled DejaVu Sans deterministically without system fonts', () => {
  const width = 300;
  const height = 150;

  const rasterizer = new SvgRasterizer({
    width,
    height,
    loadSystemFonts: false,
    defaultFontFamily: 'DejaVu Sans'
  });

  const emptySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#000000"/>
  </svg>`;

  const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#000000"/>
    <text x="30" y="80" font-family="DejaVu Sans" font-size="28" fill="#ffffff">TEST FONT</text>
  </svg>`;

  const bufEmpty = rasterizer.rasterize(emptySvg);
  const bufText = rasterizer.rasterize(textSvg);

  assert.equal(bufEmpty.byteLength, width * height * 4);
  assert.equal(bufText.byteLength, width * height * 4);

  // Verify empty buffer: all pixels are solid black background [0, 0, 0, 255]
  let emptyNonBgPixels = 0;
  for (let i = 0; i < bufEmpty.length; i += 4) {
    if (bufEmpty[i] !== 0 || bufEmpty[i + 1] !== 0 || bufEmpty[i + 2] !== 0) {
      emptyNonBgPixels++;
    }
  }
  assert.equal(emptyNonBgPixels, 0, 'Empty buffer should contain only background');

  // Verify text buffer: has white/bright non-background pixels
  let textNonBgPixels = 0;
  let diffBytes = 0;
  for (let i = 0; i < bufText.length; i += 4) {
    if (bufText[i] > 50 || bufText[i + 1] > 50 || bufText[i + 2] > 50) {
      textNonBgPixels++;
    }
    if (
      bufEmpty[i] !== bufText[i] ||
      bufEmpty[i + 1] !== bufText[i + 1] ||
      bufEmpty[i + 2] !== bufText[i + 2]
    ) {
      diffBytes++;
    }
  }

  assert.ok(textNonBgPixels > 200, `Text element must produce non-background pixels (found: ${textNonBgPixels})`);
  assert.ok(diffBytes > 200, `Buffer with text must differ from empty buffer (pixel difference: ${diffBytes})`);
});

test('Font Rasterizer: Explicitly rejects when deterministic font file is missing with loadSystemFonts=false', () => {
  const missingPath = '/tmp/non_existent_font_path_12345.ttf';

  assert.throws(
    () => {
      new SvgRasterizer({
        loadSystemFonts: false,
        fontPath: missingPath
      });
    },
    (err: Error) => {
      return (
        err.message.includes('Deterministic font file not found') &&
        err.message.includes(missingPath)
      );
    }
  );
});
