import test from 'node:test';
import assert from 'node:assert/strict';
import { SvgBuilder, escapeXmlText } from '../src/engine/compositor/svg-builder.js';

test('SvgBuilder: escapeXmlText encodes special characters including = as &#61;', () => {
  const input = 'one = two & <three> "four"';
  const escaped = escapeXmlText(input);
  assert.equal(escaped, 'one &#61; two &amp; &lt;three&gt; "four"');

  // Verify that an SVG text element containing "=" passes policy validation without triggering EVENT_HANDLER_DETECTED
  const builder = new SvgBuilder();
  builder.addText('a = b', 100, 100);
  assert.doesNotThrow(() => builder.build());
});

test('SvgBuilder: addPath renders valid M, L, C, Z path commands and styles', () => {
  const builder = new SvgBuilder();
  builder.addPath(
    [
      { cmd: 'M', x: 10, y: 20 },
      { cmd: 'L', x: 50, y: 60 },
      { cmd: 'C', x1: 60, y1: 70, x2: 80, y2: 90, x: 100, y: 110 },
      { cmd: 'Z' }
    ],
    {
      fill: '#ff00aa',
      stroke: { paint: '#ffffff', width: 2, lineJoin: 'round', lineCap: 'round' },
      opacity: 0.9
    }
  );

  const svg = builder.build();
  assert.ok(svg.includes('d="M 10.00 20.00 L 50.00 60.00 C 60.00 70.00 80.00 90.00 100.00 110.00 Z"'));
  assert.ok(svg.includes('fill="#ff00aa"'));
  assert.ok(svg.includes('stroke="#ffffff"'));
  assert.ok(svg.includes('stroke-width="2.00"'));
  assert.ok(svg.includes('stroke-linejoin="round"'));
  assert.ok(svg.includes('stroke-linecap="round"'));
  assert.ok(svg.includes('opacity="0.90"'));
});

test('SvgBuilder: Supports linear and radial gradients with paint references', () => {
  const builder = new SvgBuilder();
  builder.addLinearGradient('grad_linear', {
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 1,
    stops: [
      { offset: 0, color: '#112233', opacity: 1 },
      { offset: 1, color: '#445566', opacity: 0.5 }
    ]
  });

  builder.addRadialGradient('grad_radial', {
    cx: 0.5,
    cy: 0.5,
    r: 0.5,
    stops: [
      { offset: 0, color: '#ffffff' },
      { offset: 1, color: '#000000' }
    ]
  });

  builder.addPath([{ cmd: 'M', x: 0, y: 0 }, { cmd: 'L', x: 10, y: 10 }, { cmd: 'Z' }], {
    fill: { gradientId: 'grad_linear' },
    stroke: { paint: { gradientId: 'grad_radial' }, width: 1 }
  });

  const svg = builder.build();
  assert.ok(svg.includes('<linearGradient id="grad_linear"'));
  assert.ok(svg.includes('<radialGradient id="grad_radial"'));
  assert.ok(svg.includes('fill="url(#grad_linear)"'));
  assert.ok(svg.includes('stroke="url(#grad_radial)"'));
});

test('SvgBuilder: Group nesting and balancing validation', () => {
  const builder = new SvgBuilder();

  // Test addGroup helper
  builder.addGroup({ id: 'hero_group', opacity: 0.8 }, (b) => {
    b.addRect(10, 10, 50, 50, '#123456');
  });

  const svg = builder.build();
  assert.ok(svg.includes('<g id="hero_group" opacity="0.80">'));
  assert.ok(svg.includes('</g>'));

  // Test unclosed beginGroup
  const unclosedBuilder = new SvgBuilder();
  unclosedBuilder.beginGroup({ id: 'open_group' });
  assert.throws(() => unclosedBuilder.build(), /Unclosed SVG group/);

  // Test unmatched endGroup
  const unmatchedBuilder = new SvgBuilder();
  assert.throws(() => unmatchedBuilder.endGroup(), /Unmatched endGroup/);
});

test('SvgBuilder: Input validation rejects bad IDs, non-finite numbers, and invalid gradient stops', () => {
  // Bad def ID
  const b1 = new SvgBuilder();
  assert.throws(
    () =>
      b1.addLinearGradient('bad id with spaces!', {
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 1,
        stops: [{ offset: 0, color: '#000' }]
      }),
    /Invalid SVG ID/
  );

  // Duplicate def ID
  const b2 = new SvgBuilder();
  b2.addLinearGradient('dup_id', {
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 1,
    stops: [{ offset: 0, color: '#000' }]
  });
  assert.throws(
    () =>
      b2.addLinearGradient('dup_id', {
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 1,
        stops: [{ offset: 0, color: '#fff' }]
      }),
    /Duplicate SVG def ID/
  );

  // Non-decreasing gradient stops
  const b3 = new SvgBuilder();
  assert.throws(
    () =>
      b3.addLinearGradient('bad_stops', {
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 1,
        stops: [
          { offset: 0.8, color: '#000' },
          { offset: 0.2, color: '#fff' }
        ]
      }),
    /offsets must be non-decreasing/
  );

  // Radial gradient radius <= 0
  const b4 = new SvgBuilder();
  assert.throws(
    () =>
      b4.addRadialGradient('bad_rad', {
        cx: 0.5,
        cy: 0.5,
        r: -0.1,
        stops: [{ offset: 0, color: '#000' }]
      }),
    /radius must be strictly positive/
  );

  // Non-finite number in element
  const b5 = new SvgBuilder();
  assert.throws(() => b5.addCircle(NaN, 100, 50, '#ff0000'), /Invalid non-finite number/);
});
