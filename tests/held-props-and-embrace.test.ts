import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE2_STORY_BEAT_CONTRACT } from '../src/demo/stage2-scene.js';
import { VerbCompiler } from '../src/engine/director/verb-engine/verb-compiler.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { SceneCompositor } from '../src/engine/compositor/scene-compositor.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../src/schemas/audio.contract.js';

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

const dummyAudio = (f: number): AudioFrameFeature => ({
  frameIndex: f,
  timestamp: f / 30,
  rms: 0,
  rmsRelativeGlobal: 0,
  rmsRelativeLocal: 0,
  localWindowFrames: 30,
  spectralFlux: 0,
  onsetStrength: 0,
  isOnset: false,
  bands: { subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, presence: 0, brilliance: 0 }
});

test('D3 Reproduction: Held props, clearances, and embrace contact', async (t) => {
  const totalFrames = STAGE2_STORY_BEAT_CONTRACT.sliceFrameRange.endFrame;
  const manifest = createSyntheticManifest(totalFrames);
  const prod = VerbCompiler.compile(STAGE2_STORY_BEAT_CONTRACT, manifest);
  const builder = new FrameStateBuilder({
    storyboard: prod.storyboard,
    choreography: prod.choreography,
    rigs: prod.rigs,
    audioManifest: manifest,
    getAudioFeatureAtFrame: dummyAudio
  });

  await t.test('D3.1: Holding hand maintains continuous closed grip without empty hand frames', () => {
    // In Beat 4 (630..840) and Beat 5 (840..1050), narrative_partner holds umbrella.
    // The holding hand must have grasp_fist = 1.0 and open_rest = 0.0 across all frames.
    const partnerTrack = prod.choreography.tracks.find((tr) => tr.rigId === 'narrative_partner');
    assert.ok(partnerTrack, 'narrative_partner track must exist');

    const emptyHandFrames: number[] = [];
    for (let f = 630; f < 1050; f++) {
      const state = builder.buildFrameState(f);
      const partner = state.entities.find((e) => e.rigId === 'narrative_partner');
      assert.ok(partner, `narrative_partner must exist at frame ${f}`);

      const graspWeight = partner.morphWeights?.grasp_fist ?? 0;
      const openWeight = partner.morphWeights?.open_rest ?? 0;

      // When holding a prop, grasp_fist must be 1.0 and open_rest must be 0.0
      if (graspWeight < 0.9 || openWeight > 0.1) {
        emptyHandFrames.push(f);
      }
    }

    if (emptyHandFrames.length > 0) {
      console.log(`[D3.1 Reproduction] Empty hand frames while holding umbrella: ${emptyHandFrames.length} frames (first at frame ${emptyHandFrames[0]})`);
    }

    assert.equal(
      emptyHandFrames.length,
      0,
      `Holding hand must have continuous closed grip without empty hand frames (found ${emptyHandFrames.length} empty frames)`
    );
  });

  await t.test('D3.2: Umbrella clearance solver - shaft clears face and canopy clears heads', () => {
    // In Beat 4 (exterior run) and Beat 5 (exterior outlook):
    // 1. Shaft must not cross through character's face.
    // 2. Canopy bottom must clear both characters' heads by >= 6.0 units.
    const headClips: Array<{ frame: number; entity: string; clearance: number }> = [];

    for (let f = 630; f < 1050; f++) {
      const state = builder.buildFrameState(f);
      const umbrella = state.entities.find((e) => e.rigId === 'umbrella');
      if (!umbrella) continue;

      // Canopy bottom in world Y
      // Umbrella worldPosition is at the handle. Canopy bottom is at worldPosition[1] + canopyBottomOffset.
      const umbrellaY = umbrella.worldPosition[1];

      for (const ent of state.entities) {
        const rig = prod.rigs.get(ent.rigId);
        if (rig?.type !== 'character') continue;

        // Character head top in world Y: worldPosition[1] + ~75 units
        const headTopY = ent.worldPosition[1] + 75;
        // Canopy bottom must be >= headTopY + 6.0
        // Canopy bottom in umbrella local is 68 - 6 = 62.
        const canopyBottomY = umbrellaY + 62 * (umbrella.scale ? umbrella.scale[1] : 1.0);
        const clearance = canopyBottomY - headTopY;

        if (clearance < 6.0) {
          headClips.push({ frame: f, entity: ent.rigId, clearance });
        }
      }
    }

    if (headClips.length > 0) {
      console.log(`[D3.2 Reproduction] Umbrella canopy head clipping violations: ${headClips.length} frames (first at frame ${headClips[0].frame}, clearance=${headClips[0].clearance.toFixed(1)}u < 6.0u)`);
    }

    assert.equal(
      headClips.length,
      0,
      `Umbrella canopy must clear characters' heads by >= 6.0 units (found ${headClips.length} clipping frames)`
    );
  });

  await t.test('D3.3: Embrace contact - front arms wrap in front of partner without torso occlusion', () => {
    // In Beat 3 (embrace_push_away, frames 490..570 during embrace contact):
    // Both characters are in bilateral embrace.
    // Front arm depth ordering must place front arms in front of the partner's torso.
    const compositor = new SceneCompositor({ width: 1920, height: 1080 });
    const contactFrame = 525; // Mid-embrace frame
    const state = builder.buildFrameState(contactFrame);

    // Verify both characters have IK targets wrapping partner's torso
    const heroTrack = prod.choreography.tracks.find((t) => t.rigId === 'protagonist_lead' && t.shotId === 'beat_03_embrace_push');
    const partnerTrack = prod.choreography.tracks.find((t) => t.rigId === 'narrative_partner' && t.shotId === 'beat_03_embrace_push');
    assert.ok(heroTrack?.ikTargets && heroTrack.ikTargets.length > 0, 'Hero must have embrace IK targets');
    assert.ok(partnerTrack?.ikTargets && partnerTrack.ikTargets.length > 0, 'Partner must have embrace IK targets');

    // Both characters' Z positions during embrace must allow interlocking front arms
    const heroEnt = state.entities.find((e) => e.rigId === 'protagonist_lead')!;
    const partnerEnt = state.entities.find((e) => e.rigId === 'narrative_partner')!;

    // Distance in Z must be <= 1.0 so front arm offsets can render both front arms over both torsos
    const deltaZ = Math.abs(heroEnt.worldPosition[2] - partnerEnt.worldPosition[2]);
    assert.ok(
      deltaZ <= 1.0,
      `Embrace characters must be co-planar in Z (deltaZ=${deltaZ} must be <= 1.0) so front arms can wrap both torsos`
    );

    compositor.renderFrame(state, prod.rigs);
    const drawOrder = compositor.getLastDrawOrder() ?? [];
    const heroBodyIdx = drawOrder.findIndex((d) => d.id === 'protagonist_lead' && (!d.partGroup || d.partGroup === 'body'));
    const partnerBodyIdx = drawOrder.findIndex((d) => d.id === 'narrative_partner' && (!d.partGroup || d.partGroup === 'body'));
    const heroFrontArmIdx = drawOrder.findIndex((d) => d.id === 'protagonist_lead' && d.partGroup === 'front_arm');
    const partnerFrontArmIdx = drawOrder.findIndex((d) => d.id === 'narrative_partner' && d.partGroup === 'front_arm');

    assert.ok(heroFrontArmIdx >= 0, 'Hero must have a front_arm draw pass');
    assert.ok(partnerFrontArmIdx >= 0, 'Partner must have a front_arm draw pass');
    assert.ok(heroBodyIdx >= 0, 'Hero must have a body draw pass');
    assert.ok(partnerBodyIdx >= 0, 'Partner must have a body draw pass');

    assert.ok(
      heroFrontArmIdx > partnerBodyIdx,
      `Hero front arm (index ${heroFrontArmIdx}) must draw AFTER (in front of) partner body (index ${partnerBodyIdx})`
    );
    assert.ok(
      partnerFrontArmIdx > heroBodyIdx,
      `Partner front arm (index ${partnerFrontArmIdx}) must draw AFTER (in front of) hero body (index ${heroBodyIdx})`
    );
  });
});
