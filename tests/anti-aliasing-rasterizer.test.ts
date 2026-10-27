import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SvgRasterizer } from '../src/renderer/rasterizer.js';
import { SceneCompositor } from '../src/engine/compositor/scene-compositor.js';
import { VerbCompiler } from '../src/engine/director/verb-engine/verb-compiler.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { STAGE2_STORY_BEAT_CONTRACT } from '../src/demo/stage2-scene.js';
import { STAGE1_STORY_BEAT_CONTRACT } from '../src/demo/stage1-scene.js';
import { validateSvgPolicy } from '../src/engine/compositor/svg-policy-validator.js';
import type { AudioFrameFeature } from '../src/schemas/audio.contract.js';

test('Anti-Aliasing & Rasterizer Quality Suite', async (t) => {
  await t.test('(a) Production rasterizer renders smooth anti-aliased edge with > 50 distinct luminance levels', () => {
    const width = 1920;
    const height = 1080;
    const rasterizer = new SvgRasterizer({ width, height, loadSystemFonts: false });

    // Diagonal thin 1.5px outline over dark gradient backdrop
    const testSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a1128"/>
      <stop offset="1" stop-color="#1c2d5a"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <polygon points="120.4,85.2 1820.7,310.8 1540.2,1010.5 80.6,890.3" stroke="#00f0ff" stroke-width="1.5" fill="none"/>
</svg>`;

    const buf = rasterizer.rasterize(testSvg);
    assert.equal(buf.byteLength, width * height * 4);

    const uniqueLuminances = new Set<number>();
    for (let i = 0; i < buf.length; i += 4) {
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      uniqueLuminances.add(lum);
    }

    // With anti-aliasing enabled, the edge produces a continuous subpixel transition (> 50 distinct levels)
    assert.ok(
      uniqueLuminances.size > 50,
      `Expected smooth anti-aliased edge (> 50 distinct luminance levels), found: ${uniqueLuminances.size}`
    );
  });

  await t.test('(b) Static audit: rasterizer constructor passes zero global optimizeSpeed overrides', () => {
    const rasterizerFile = path.resolve(process.cwd(), 'src', 'renderer', 'rasterizer.ts');
    const content = fs.readFileSync(rasterizerFile, 'utf8');

    // Assert shapeRendering: 0, textRendering: 0, imageRendering: 1 are not passed globally to new Resvg
    assert.ok(
      !content.includes('shapeRendering: 0'),
      'rasterizer.ts must not pass global shapeRendering: 0'
    );
    assert.ok(
      !content.includes('textRendering: 0'),
      'rasterizer.ts must not pass global textRendering: 0'
    );
    assert.ok(
      !content.includes('imageRendering: 1'),
      'rasterizer.ts must not pass global imageRendering: 1'
    );
  });

  await t.test('(c) Policy validator rejects shape-rendering on text, characters, props, and captions', () => {
    // 1. shape-rendering on text is forbidden
    const textViolation = validateSvgPolicy(
      '<svg xmlns="http://www.w3.org/2000/svg"><text shape-rendering="optimizeSpeed">Hello</text></svg>'
    );
    assert.equal(textViolation.valid, false);
    assert.ok(textViolation.violations.some((v) => v.rule === 'DISALLOWED_SHAPE_RENDERING'));

    // 2. shape-rendering on character part is forbidden
    const charViolation = validateSvgPolicy(
      '<svg xmlns="http://www.w3.org/2000/svg"><polygon id="char_hero_torso" points="0,0 10,10 0,10" shape-rendering="optimizeSpeed"/></svg>'
    );
    assert.equal(charViolation.valid, false);
    assert.ok(charViolation.violations.some((v) => v.rule === 'DISALLOWED_SHAPE_RENDERING'));

    // 3. shape-rendering on prop is forbidden
    const propViolation = validateSvgPolicy(
      '<svg xmlns="http://www.w3.org/2000/svg"><polygon id="prop_umbrella_canopy" points="0,0 10,10 0,10" shape-rendering="optimizeSpeed"/></svg>'
    );
    assert.equal(propViolation.valid, false);
    assert.ok(propViolation.violations.some((v) => v.rule === 'DISALLOWED_SHAPE_RENDERING'));
  });

  await t.test('(d) Rendered frames never apply shape-rendering to characters, props, or captions', () => {
    const dummyAudio = (frameIndex: number): AudioFrameFeature => ({
      frameIndex,
      timestamp: frameIndex / 30,
      rms: 0.1,
      rmsRelativeGlobal: 0.1,
      rmsRelativeLocal: 0.1,
      localWindowFrames: 30,
      spectralFlux: 0.05,
      onsetStrength: 0.1,
      isOnset: false,
      bands: { subBass: 0.1, bass: 0.1, lowMid: 0.1, mid: 0.1, highMid: 0.1, presence: 0.1, brilliance: 0.1 }
    });

    const checkContract = (contract: typeof STAGE1_STORY_BEAT_CONTRACT) => {
      const prod = VerbCompiler.compile(contract);
      const builder = new FrameStateBuilder({
        storyboard: prod.storyboard,
        choreography: prod.choreography,
        rigs: prod.rigs,
        audioManifest: {
          metadata: { audioFilePath: 'a.wav', sampleRate: 44100, durationSeconds: 35, totalFrames: 1050, fps: 30 },
          normalization: { globalRmsMax: 1, localWindowFrames: 30 },
          lyrics: [],
          beatEvents: [],
          storageReference: { type: 'memory_columnar', columnLayoutVersion: 1 }
        },
        getAudioFeatureAtFrame: dummyAudio
      });
      const compositor = new SceneCompositor({ width: 1920, height: 1080, fps: 30 });

      // Sample frames across shots
      for (const f of [0, 150, 300, 600, 900]) {
        const frameState = builder.buildFrameState(f);
        const { svg } = compositor.renderFrame(frameState, prod.rigs);

        // Verify SVG policy passes
        const policyResult = validateSvgPolicy(svg);
        assert.ok(policyResult.valid, `Frame ${f} violated SVG policy: ${JSON.stringify(policyResult.violations)}`);

        // Assert no shape-rendering on text
        assert.ok(!/<text\b[^>]*shape-rendering/i.test(svg), `Frame ${f} has shape-rendering on <text>`);
      }
    };

    checkContract(STAGE1_STORY_BEAT_CONTRACT);
    checkContract(STAGE2_STORY_BEAT_CONTRACT);
  });
});
