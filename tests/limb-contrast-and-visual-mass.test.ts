import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE1_STORY_BEAT_CONTRACT } from '../src/demo/stage1-scene.js';
import { STAGE2_STORY_BEAT_CONTRACT } from '../src/demo/stage2-scene.js';
import { VerbCompiler } from '../src/engine/director/verb-engine/verb-compiler.js';
import type { AudioAnalysisManifest } from '../src/schemas/audio.contract.js';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) / 255,
      parseInt(clean[1] + clean[1], 16) / 255,
      parseInt(clean[2] + clean[2], 16) / 255
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255
  ];
}

function channelLuminance(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function wcagContrast(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function polygonArea(points: ReadonlyArray<readonly [number, number]>): number {
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += points[i][0] * points[j][1] - points[j][0] * points[i][1];
  }
  return Math.abs(sum) / 2;
}

const createSyntheticManifest = (totalFrames: number): AudioAnalysisManifest => ({
  metadata: {
    audioFilePath: 'synthetic.wav',
    sampleRate: 44100,
    durationSeconds: totalFrames / 30,
    totalFrames,
    fps: 30
  },
  normalization: { globalRmsMax: 1.0, localWindowFrames: 30 },
  lyrics: [],
  beatEvents: [],
  storageReference: { type: 'memory_columnar', columnLayoutVersion: 1 }
});



test('D4 Reproduction: Limb outline contrast and visual mass', async (t) => {
  const totalFrames1 = STAGE1_STORY_BEAT_CONTRACT.sliceFrameRange.endFrame;
  const manifest1 = createSyntheticManifest(totalFrames1);
  const prod1 = VerbCompiler.compile(STAGE1_STORY_BEAT_CONTRACT, manifest1);

  const totalFrames2 = STAGE2_STORY_BEAT_CONTRACT.sliceFrameRange.endFrame;
  const manifest2 = createSyntheticManifest(totalFrames2);
  const prod2 = VerbCompiler.compile(STAGE2_STORY_BEAT_CONTRACT, manifest2);

  await t.test('D4.1: Every character limb part guarantees WCAG contrast ratio >= 3:1 against local backdrop', () => {
    // Check rigs across Stage 1 and Stage 2
    const rigs = [...prod1.rigs.values(), ...prod2.rigs.values()].filter(
      (r) => r.type === 'character'
    );

    const limbPartRegex = /arm|leg|thigh|shin|foot|bicep|forearm|gauntlet|greave|boot/;
    const lowContrastViolations: Array<{ rig: string; part: string; stroke: string; contrast: number }> = [];

    // Backdrop luminance in moody_night and dramatic_twilight is approx 0.02 - 0.08
    const estimatedBackdropL = relativeLuminance('#090b16');

    for (const rig of rigs) {
      for (const part of rig.parts) {
        if (!limbPartRegex.test(part.id)) continue;

        // Limb must have a visible stroke
        const strokePaint = part.style.stroke?.paint;
        assert.ok(strokePaint, `${rig.id} part ${part.id} must declare a visible stroke`);

        let strokeHex = '#000000';
        if (strokePaint.kind === 'solid') {
          strokeHex = strokePaint.color;
        }

        const strokeL = relativeLuminance(strokeHex);
        const contrast = wcagContrast(strokeL, estimatedBackdropL);

        if (contrast < 3.0) {
          lowContrastViolations.push({
            rig: rig.id,
            part: part.id,
            stroke: strokeHex,
            contrast: Number(contrast.toFixed(2))
          });
        }
      }
    }

    if (lowContrastViolations.length > 0) {
      console.log(
        `[D4.1 Reproduction] Limb parts with WCAG contrast < 3:1: ${lowContrastViolations.length} violations:`
      );
      for (const v of lowContrastViolations.slice(0, 10)) {
        console.log(`  - ${v.rig} ${v.part}: stroke=${v.stroke}, contrast=${v.contrast}:1 < 3.0:1`);
      }
    }

    assert.equal(
      lowContrastViolations.length,
      0,
      `Every limb part must have WCAG contrast >= 3:1 against backdrop (found ${lowContrastViolations.length} violations)`
    );
  });

  await t.test('D4.2: Coat/cape parts maintain minimum projected area ratio >= 0.75 relative to torso', () => {
    const rigs = [...prod1.rigs.values(), ...prod2.rigs.values()].filter(
      (r) => r.type === 'character'
    );

    const MIN_COAT_RATIO = 0.75;
    const collapsingCoats: Array<{ rig: string; coatArea: number; torsoArea: number; ratio: number }> = [];

    for (const rig of rigs) {
      const torso = rig.parts.find((p) => p.id === 'torso_body');
      if (!torso || torso.shape.kind !== 'polygon') continue;

      const torsoArea = polygonArea(torso.shape.points);

      // Collect all coat/cape/cloak/mantle/shawl parts
      const coatParts = rig.parts.filter(
        (p) =>
          p.id.includes('coat') ||
          p.id.includes('cape') ||
          p.id.includes('cloak') ||
          p.id.includes('mantle') ||
          p.id.includes('shawl')
      );

      let totalCoatArea = 0;
      for (const cp of coatParts) {
        if (cp.shape.kind === 'polygon') {
          totalCoatArea += polygonArea(cp.shape.points);
        }
      }

      const ratio = totalCoatArea / torsoArea;
      if (ratio < MIN_COAT_RATIO) {
        collapsingCoats.push({
          rig: rig.id,
          coatArea: totalCoatArea,
          torsoArea,
          ratio: Number(ratio.toFixed(2))
        });
      }
    }

    if (collapsingCoats.length > 0) {
      console.log(`[D4.2 Reproduction] Collapsing coat/cape ratios: ${collapsingCoats.length} rigs`);
      for (const c of collapsingCoats) {
        console.log(`  - ${c.rig}: coatArea=${c.coatArea}, torsoArea=${c.torsoArea}, ratio=${c.ratio} < ${MIN_COAT_RATIO}`);
      }
    }

    assert.equal(
      collapsingCoats.length,
      0,
      `Coat/cape parts must maintain area ratio >= ${MIN_COAT_RATIO} relative to torso`
    );
  });

  await t.test('D4.3: Interior fills maintain minimum luminance separation from backdrop estimate', () => {
    const rigs = [...prod1.rigs.values(), ...prod2.rigs.values()].filter(
      (r) => r.type === 'character'
    );

    const estimatedBackdropL = relativeLuminance('#090b16');
    const MIN_FILL_CONTRAST = 1.35; // Minimum luminance ratio between interior fill and backdrop
    const lowSeparationFills: Array<{ rig: string; part: string; fill: string; contrast: number }> = [];

    for (const rig of rigs) {
      for (const part of rig.parts) {
        // Test primary body parts (torso, thighs, biceps)
        if (!/torso_body|bicep|thigh/.test(part.id)) continue;
        if (!part.style.fill || part.style.fill.kind !== 'solid') continue;

        const fillHex = part.style.fill.color;
        const fillL = relativeLuminance(fillHex);
        const contrast = wcagContrast(fillL, estimatedBackdropL);

        if (contrast < MIN_FILL_CONTRAST) {
          lowSeparationFills.push({
            rig: rig.id,
            part: part.id,
            fill: fillHex,
            contrast: Number(contrast.toFixed(2))
          });
        }
      }
    }

    if (lowSeparationFills.length > 0) {
      console.log(`[D4.3 Reproduction] Low separation interior fills: ${lowSeparationFills.length} violations`);
      for (const f of lowSeparationFills.slice(0, 10)) {
        console.log(`  - ${f.rig} ${f.part}: fill=${f.fill}, contrast=${f.contrast}:1 < ${MIN_FILL_CONTRAST}:1`);
      }
    }

    assert.equal(
      lowSeparationFills.length,
      0,
      `Interior fills must maintain contrast >= ${MIN_FILL_CONTRAST}:1 against backdrop (found ${lowSeparationFills.length} violations)`
    );
  });
});
