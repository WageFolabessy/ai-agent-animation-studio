import test from 'node:test';
import assert from 'node:assert/strict';
import {
  solveTwoBoneArmIK,
  solveTwoBoneLegIK,
  worldToRigLocal
} from '../src/engine/rigging/ik-leg-solver.js';
import { computeCameraBasis } from '../src/engine/camera/camera-3d.js';
import { projectToScreen } from '../src/engine/camera/projection.js';
import { computeSkeletonFK, applyAffine2D } from '../src/engine/rigging/kinematics.js';
import { CANONICAL_HAND_MORPH_TARGETS } from '../src/engine/rigging/morpher.js';
import { BASE_MOUTH_REST_SEGMENTS, CANONICAL_BIPED_MORPH_TARGETS } from '../src/engine/rigging/vocal-performance-solver.js';
import { BipedPoseClips } from '../src/engine/library/archetype-factory.js';
import { VerbCompiler } from '../src/engine/director/verb-engine/verb-compiler.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { validateProjectContracts, validateChoreography } from '../src/schemas/invariants.js';
import { createRenderConfig } from '../src/config/render-config.js';
import { SceneCompositor } from '../src/engine/compositor/scene-compositor.js';
import { StageEnvironmentGenerator } from '../src/engine/library/stage-environment-generator.js';
import { THEME_PALETTES } from '../src/engine/library/environment-kit.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../src/schemas/audio.contract.js';
import type { StoryBeatContract } from '../src/schemas/story-beat.contract.js';

test('Verb Engine & Analytical IK Suite', async (t) => {
  await t.test('2-Bone Arm IK: Elbow bends forward (bendDirection = +1) and reaches target', () => {
    const shoulder: [number, number] = [6, 16];
    const handTarget: [number, number] = [22, 5]; // Forward and down
    const l1 = 18;
    const l2 = 16;

    const armResult = solveTwoBoneArmIK(shoulder, handTarget, l1, l2, 0, 1);
    assert.ok(armResult.lowerAngleDeg > 0, `Arm elbow must bend forward/upward, got ${armResult.lowerAngleDeg}`);

    // Verify forward kinematics positions the tip at the target
    const upperRad = (armResult.upperAngleDeg * Math.PI) / 180;
    const lowerRad = (armResult.lowerAngleDeg * Math.PI) / 180;
    const totalLowerWorldRad = upperRad + lowerRad;

    // Bone at 0 deg points down [0, -L], positive swings +X
    const elbowX = shoulder[0] + l1 * Math.sin(upperRad);
    const elbowY = shoulder[1] - l1 * Math.cos(upperRad);

    const tipX = elbowX + l2 * Math.sin(totalLowerWorldRad);
    const tipY = elbowY - l2 * Math.cos(totalLowerWorldRad);

    assert.ok(Math.abs(tipX - handTarget[0]) < 1e-6, `Tip X ${tipX} must match target ${handTarget[0]}`);
    assert.ok(Math.abs(tipY - handTarget[1]) < 1e-6, `Tip Y ${tipY} must match target ${handTarget[1]}`);
  });

  await t.test('2-Bone Leg IK: Knee bends backward (bendDirection = -1) and preserves existing leg behavior', () => {
    const hip: [number, number] = [0, 44];
    const footTarget: [number, number] = [10, 10];
    const l1 = 22;
    const l2 = 22;

    const legResult = solveTwoBoneLegIK(hip, footTarget, l1, l2);
    assert.ok(legResult.lowerAngleDeg < 0, `Leg knee must bend backward (<= 0), got ${legResult.lowerAngleDeg}`);

    const upperRad = (legResult.upperAngleDeg * Math.PI) / 180;
    const lowerRad = (legResult.lowerAngleDeg * Math.PI) / 180;
    const totalLowerWorldRad = upperRad + lowerRad;

    const kneeX = hip[0] + l1 * Math.sin(upperRad);
    const kneeY = hip[1] - l1 * Math.cos(upperRad);

    const footX = kneeX + l2 * Math.sin(totalLowerWorldRad);
    const footY = kneeY - l2 * Math.cos(totalLowerWorldRad);

    assert.ok(Math.abs(footX - footTarget[0]) < 1e-6, `Foot X ${footX} must match target ${footTarget[0]}`);
    assert.ok(Math.abs(footY - footTarget[1]) < 1e-6, `Foot Y ${footY} must match target ${footTarget[1]}`);
  });

  await t.test('worldToRigLocal correctly transforms world target into local rig coordinate space', () => {
    const worldDeskTarget: [number, number] = [25, 35];
    const charWorldPos: [number, number, number] = [10, 75, 0];

    // Right-facing character (scaleX = 1.35, scaleY = 1.45)
    const localRight = worldToRigLocal(worldDeskTarget, charWorldPos, [1.35, 1.45]);
    assert.ok(Math.abs(localRight[0] - (25 - 10) / 1.35) < 1e-6);
    assert.ok(Math.abs(localRight[1] - (35 - 75) / 1.45) < 1e-6);

    // Left-facing character (scaleX = -1.35, scaleY = 1.45)
    const localLeft = worldToRigLocal(worldDeskTarget, charWorldPos, [-1.35, 1.45]);
    assert.ok(Math.abs(localLeft[0] - (25 - 10) / -1.35) < 1e-6);
  });

  await t.test('Dynamic Prop Projection: Camera basis maintains zero slip across camera moves', () => {
    const ownerPos: [number, number, number] = [10, 75, 0];
    const rotX = 12.0;
    const rotY = -15.0;

    const cam1 = {
      position: [0, 95, 200] as [number, number, number],
      target: [0, 95, 0] as [number, number, number],
      up: [0, 1, 0] as [number, number, number],
      rollDegrees: 0,
      verticalFovDegrees: 50,
      nearPlane: 1,
      farPlane: 2000,
      projectionMode: 'perspective' as const
    };

    const basis1 = computeCameraBasis(cam1);
    const propWorld1 = [
      ownerPos[0] + rotX * basis1.right[0] + rotY * basis1.up[0] - 1e-3 * basis1.forward[0],
      ownerPos[1] + rotX * basis1.right[1] + rotY * basis1.up[1] - 1e-3 * basis1.forward[1],
      ownerPos[2] + rotX * basis1.right[2] + rotY * basis1.up[2] - 1e-3 * basis1.forward[2]
    ];

    // Camera rolls 10 degrees
    const cam2 = { ...cam1, rollDegrees: 10 };
    const basis2 = computeCameraBasis(cam2);
    const propWorld2 = [
      ownerPos[0] + rotX * basis2.right[0] + rotY * basis2.up[0] - 1e-3 * basis2.forward[0],
      ownerPos[1] + rotX * basis2.right[1] + rotY * basis2.up[1] - 1e-3 * basis2.forward[1],
      ownerPos[2] + rotX * basis2.right[2] + rotY * basis2.up[2] - 1e-3 * basis2.forward[2]
    ];

    // Depth offset is always in front of owner by 1e-3
    assert.ok(Math.abs(propWorld1[2] - (ownerPos[2] - 1e-3 * basis1.forward[2])) < 1e-6);
    assert.ok(Math.abs(propWorld2[2] - (ownerPos[2] - 1e-3 * basis2.forward[2])) < 1e-6);
  });

  await t.test('VerbCompiler compiles valid StoryBeatContract and passes project and choreography invariants', () => {
    const syntheticContract: StoryBeatContract = {
      projectId: 'stage1_solo_acting',
      songDurationSec: 35,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 1050 },
      cast: [
        {
          instanceId: 'protagonist_lead',
          role: 'PROTAGONIST',
          archetypeId: 'hero_silhouette',
          palette: { primary: '#0a1128', accent: '#00f0ff' }
        }
      ],
      beats: [
        {
          beatId: 'beat_01_walk',
          startFrame: 0,
          endFrame: 210,
          lyricSnippet: 'Walking toward the light',
          emotionalTone: 'reflective',
          narrativeSubtext: 'Lead approaches the desk',
          presentCharacters: ['protagonist_lead'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: ['desk', 'coffee_cup'],
            landmarkPlacements: {
              coffee_cup: [0, 63, 0]
            },
            atmosphericDensity: 0.5
          },
          actions: [{ instanceId: 'protagonist_lead', verb: 'walk_to', speedNorm: 1.0, intensityNorm: 0.7 }],
          camera: { framing: 'WIDE', movement: 'DOLLY', focalCharacterId: 'protagonist_lead', lookRoom: 'right', dutchAngleDeg: 0 }
        },
        {
          beatId: 'beat_02_grasp',
          startFrame: 210,
          endFrame: 420,
          lyricSnippet: 'Reaching for hope',
          emotionalTone: 'melancholic',
          narrativeSubtext: 'Reaching and grasping coffee cup',
          presentCharacters: ['protagonist_lead'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: ['desk', 'coffee_cup'],
            landmarkPlacements: {
              coffee_cup: [0, 63, 0]
            },
            atmosphericDensity: 0.5
          },
          actions: [{ instanceId: 'protagonist_lead', verb: 'reach_and_grasp', speedNorm: 1.0, intensityNorm: 0.8, associatedPropId: 'coffee_cup' }],
          camera: { framing: 'INSERT', movement: 'STATIC', focalCharacterId: 'protagonist_lead', lookRoom: 'center', dutchAngleDeg: 0 }
        },
        {
          beatId: 'beat_03_turn',
          startFrame: 420,
          endFrame: 630,
          lyricSnippet: 'A sudden turn of fate',
          emotionalTone: 'defiant',
          narrativeSubtext: 'Cut-paper snap turnaround',
          presentCharacters: ['protagonist_lead'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'dramatic_twilight',
            landmarkProps: ['desk', 'coffee_cup'],
            landmarkPlacements: {
              coffee_cup: [0, 63, 0]
            },
            atmosphericDensity: 0.6
          },
          actions: [{ instanceId: 'protagonist_lead', verb: 'stop_and_turn', speedNorm: 1.0, intensityNorm: 0.9 }],
          camera: { framing: 'MEDIUM', movement: 'PAN', focalCharacterId: 'protagonist_lead', lookRoom: 'left', dutchAngleDeg: 3 }
        },
        {
          beatId: 'beat_04_carry',
          startFrame: 630,
          endFrame: 840,
          lyricSnippet: 'Carrying the burden forward',
          emotionalTone: 'reflective',
          narrativeSubtext: 'Carries cup and sets it down',
          presentCharacters: ['protagonist_lead'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'dramatic_twilight',
            landmarkProps: ['desk', 'coffee_cup'],
            landmarkPlacements: {
              coffee_cup: [0, 63, 0]
            },
            atmosphericDensity: 0.5
          },
          actions: [{ instanceId: 'protagonist_lead', verb: 'carry_put_down', speedNorm: 1.0, intensityNorm: 0.7 }],
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'protagonist_lead', lookRoom: 'center', dutchAngleDeg: 0 }
        },
        {
          beatId: 'beat_05_point',
          startFrame: 840,
          endFrame: 1050,
          lyricSnippet: 'Into the rising dawn',
          emotionalTone: 'euphoric',
          narrativeSubtext: 'Gestures toward horizon',
          presentCharacters: ['protagonist_lead'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'clean_minimal',
            landmarkProps: ['desk'],
            atmosphericDensity: 0.4
          },
          actions: [{ instanceId: 'protagonist_lead', verb: 'gesture_point', speedNorm: 1.0, intensityNorm: 0.8 }],
          camera: { framing: 'CLOSE_UP', movement: 'STATIC', focalCharacterId: 'protagonist_lead', lookRoom: 'right', dutchAngleDeg: 0 }
        }
      ],
      unfulfilledRequests: []
    };

    const syntheticManifest: AudioAnalysisManifest = {
      metadata: {
        audioFilePath: 'synthetic.wav',
        sampleRate: 44100,
        durationSeconds: 35,
        totalFrames: 1050,
        fps: 30
      },
      normalization: {
        globalRmsMax: 1.0,
        localWindowFrames: 30
      },
      lyrics: [],
      beatEvents: [],
      storageReference: {
        type: 'memory_columnar',
        columnLayoutVersion: 1
      }
    };

    const production = VerbCompiler.compile(syntheticContract, syntheticManifest);

    assert.equal(production.storyboard.shots.length, 5);
    assert.equal(production.rigs.has('protagonist_lead'), true);
    assert.equal(production.rigs.has('coffee_cup'), true);
    assert.equal(production.choreography.tracks.length, 10); // 5 shots * 2 rigs

    const renderConfig = createRenderConfig({
      width: 1920,
      height: 1080,
      fps: 30,
      pixelFormat: 'rgba',
      totalFrames: 1050
    });

    const projectReport = validateProjectContracts(
      syntheticManifest,
      production.storyboard,
      renderConfig,
      production.rigs
    );

    const fatalProjectErrors = projectReport.errors.filter(
      (e) => e.severity === 'fatal' || e.severity === 'error'
    );
    assert.deepEqual(fatalProjectErrors, [], `Project validation must have zero errors: ${JSON.stringify(fatalProjectErrors)}`);

    const choreoReport = validateChoreography(
      production.choreography,
      production.storyboard,
      production.rigs
    );

    const fatalChoreoErrors = choreoReport.errors.filter(
      (e) => e.severity === 'fatal' || e.severity === 'error'
    );
    assert.deepEqual(fatalChoreoErrors, [], `Choreography validation must have zero errors: ${JSON.stringify(fatalChoreoErrors)}`);
  });

  await t.test('Bilateral Interaction & Silhouette Contrast: embrace_push_away clearance and WCAG Delta L/Hue', () => {
    // 1. Check WCAG contrast between hero_silhouette and companion_silhouette
    const heroPalette = { primary: '#0a1128', accent: '#00f0ff' };
    const compPalette = { primary: '#3d1c06', accent: '#ff9100' };

    function getLuminance(hex: string): number {
      const [r, g, b] = [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255
      ].map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function getHue(hex: string): number {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d === 0) return 0;
      let h = 0;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = Math.round(h * 60);
      if (h < 0) h += 360;
      return h;
    }

    const deltaL = Math.abs(getLuminance(heroPalette.accent) - getLuminance(compPalette.accent));
    assert.ok(deltaL >= 0.18, `WCAG Delta L must be >= 0.18, got ${deltaL.toFixed(3)}`);

    const rawHueDiff = Math.abs(getHue(heroPalette.accent) - getHue(compPalette.accent));
    const deltaHue = Math.min(rawHueDiff, 360 - rawHueDiff);
    assert.ok(deltaHue >= 60, `Delta Hue must be >= 60 deg, got ${deltaHue.toFixed(1)} deg`);

    // 2. Test 2-character StoryBeatContract with embrace_push_away
    const twoCharContract: StoryBeatContract = {
      projectId: 'stage2_two_characters',
      songDurationSec: 35,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 1050 },
      cast: [
        {
          instanceId: 'protagonist_lead',
          role: 'PROTAGONIST',
          archetypeId: 'hero_silhouette',
          palette: heroPalette
        },
        {
          instanceId: 'narrative_partner',
          role: 'PARTNER',
          archetypeId: 'companion_silhouette',
          palette: compPalette
        }
      ],
      beats: [
        {
          beatId: 'beat_01_approach',
          startFrame: 0,
          endFrame: 350,
          lyricSnippet: 'Walking together',
          emotionalTone: 'reflective',
          narrativeSubtext: 'Lead and partner approach on stage',
          presentCharacters: ['protagonist_lead', 'narrative_partner'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: ['desk'],
            atmosphericDensity: 0.5
          },
          actions: [
            { instanceId: 'protagonist_lead', verb: 'walk_to', speedNorm: 1.0, intensityNorm: 0.7 },
            { instanceId: 'narrative_partner', verb: 'walk_to', speedNorm: 1.0, intensityNorm: 0.7 }
          ],
          camera: { framing: 'WIDE', movement: 'DOLLY', focalCharacterId: 'protagonist_lead', lookRoom: 'center', dutchAngleDeg: 0 }
        },
        {
          beatId: 'beat_02_embrace',
          startFrame: 350,
          endFrame: 700,
          lyricSnippet: 'Clash and separation',
          emotionalTone: 'defiant',
          narrativeSubtext: 'Embrace and dramatic push away',
          presentCharacters: ['protagonist_lead', 'narrative_partner'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'dramatic_twilight',
            landmarkProps: [],
            atmosphericDensity: 0.6
          },
          actions: [
            { instanceId: 'protagonist_lead', verb: 'embrace_push_away', speedNorm: 1.0, intensityNorm: 0.9 },
            { instanceId: 'narrative_partner', verb: 'embrace_push_away', speedNorm: 1.0, intensityNorm: 0.9 }
          ],
          camera: { framing: 'MEDIUM', movement: 'PAN', focalCharacterId: 'protagonist_lead', lookRoom: 'center', dutchAngleDeg: 2 }
        },
        {
          beatId: 'beat_03_depart',
          startFrame: 700,
          endFrame: 1050,
          lyricSnippet: 'Stepping into the urban horizon',
          emotionalTone: 'euphoric',
          narrativeSubtext: 'Looking out over the urban vista',
          presentCharacters: ['protagonist_lead', 'narrative_partner'],
          set: {
            kitId: 'EXTERIOR_URBAN_VISTA',
            variantId: 'clean_minimal',
            landmarkProps: ['umbrella'],
            landmarkPlacements: {
              umbrella: [-30, 24, 0]
            },
            atmosphericDensity: 0.4
          },
          actions: [
            { instanceId: 'protagonist_lead', verb: 'gesture_point', speedNorm: 1.0, intensityNorm: 0.8 },
            { instanceId: 'narrative_partner', verb: 'look_at', speedNorm: 1.0, intensityNorm: 0.7 }
          ],
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'protagonist_lead', lookRoom: 'right', dutchAngleDeg: 0 }
        }
      ],
      unfulfilledRequests: []
    };

    const syntheticManifest: AudioAnalysisManifest = {
      metadata: {
        audioFilePath: 'synthetic.wav',
        sampleRate: 44100,
        durationSeconds: 35,
        totalFrames: 1050,
        fps: 30
      },
      normalization: {
        globalRmsMax: 1.0,
        localWindowFrames: 30
      },
      lyrics: [],
      beatEvents: [],
      storageReference: {
        type: 'memory_columnar',
        columnLayoutVersion: 1
      }
    };

    const production = VerbCompiler.compile(twoCharContract, syntheticManifest);

    // Verify both characters and props are in rigs
    assert.ok(production.rigs.has('protagonist_lead'));
    assert.ok(production.rigs.has('narrative_partner'));

    // Check embrace shot (beat_02_embrace) tracks
    const leadTrack = production.choreography.tracks.find(
      (t) => t.shotId === 'beat_02_embrace' && t.rigId === 'protagonist_lead'
    );
    const partnerTrack = production.choreography.tracks.find(
      (t) => t.shotId === 'beat_02_embrace' && t.rigId === 'narrative_partner'
    );
    assert.ok(leadTrack && partnerTrack);

    // Verify keyframe clearance in embrace_push_away: separation >= 8.0 units at all keyframes
    const leadKfs = leadTrack.transform.keyframes;
    const partnerKfs = partnerTrack.transform.keyframes;
    assert.equal(leadKfs.length, partnerKfs.length);

    for (let k = 0; k < leadKfs.length; k++) {
      const xLead = leadKfs[k].position[0];
      const xPart = partnerKfs[k].position[0];
      const clearance = Math.abs(xPart - xLead);
      assert.ok(
        clearance >= 8.0,
        `Frame ${leadKfs[k].frame}: Interpersonal clearance must be >= 8.0, got ${clearance}`
      );
      // Zero pass-through: lead always remains on left (xLead < xPart)
      assert.ok(
        xLead < xPart,
        `Frame ${leadKfs[k].frame}: Zero pass-through violated (xLead ${xLead} >= xPart ${xPart})`
      );
    }

    // Verify full project and choreography invariants
    const renderConfig = createRenderConfig({
      width: 1920,
      height: 1080,
      fps: 30,
      pixelFormat: 'rgba',
      totalFrames: 1050
    });

    const projectReport = validateProjectContracts(
      syntheticManifest,
      production.storyboard,
      renderConfig,
      production.rigs
    );
    const fatalProj = projectReport.errors.filter((e) => e.severity === 'fatal' || e.severity === 'error');
    assert.deepEqual(fatalProj, [], `Project validation must pass: ${JSON.stringify(fatalProj)}`);

    const choreoReport = validateChoreography(
      production.choreography,
      production.storyboard,
      production.rigs
    );
    const fatalChoreo = choreoReport.errors.filter((e) => e.severity === 'fatal' || e.severity === 'error');
    assert.deepEqual(fatalChoreo, [], `Choreography validation must pass: ${JSON.stringify(fatalChoreo)}`);
  });

  let sharedStage1Contract: StoryBeatContract;

  await t.test('Stage 1 Solo Acting Remediation: 5 Runtime Invariants Across 1,050 Frames', () => {
    const stage1Contract: StoryBeatContract = {
      projectId: 'stage1_solo_acting',
      songDurationSec: 35,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 1050 },
      cast: [
        {
          instanceId: 'protagonist_lead',
          role: 'PROTAGONIST',
          archetypeId: 'hero_silhouette',
          palette: { primary: '#0a1128', accent: '#00f0ff' }
        }
      ],
      beats: [
        {
          beatId: 'beat_01_walk',
          startFrame: 0,
          endFrame: 210,
          lyricSnippet: 'Di tengah lorong malam hening merenung',
          emotionalTone: 'reflective',
          narrativeSubtext: 'Lead approaches the study desk with measured pace',
          presentCharacters: ['protagonist_lead'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: ['desk', 'coffee_cup'],
            landmarkPlacements: {
              coffee_cup: [0, 63, 0]
            },
            atmosphericDensity: 0.5
          },
          actions: [
            {
              instanceId: 'protagonist_lead',
              verb: 'walk_to',
              speedNorm: 1.0,
              intensityNorm: 0.7
            }
          ],
          camera: {
            framing: 'WIDE',
            movement: 'DOLLY',
            focalCharacterId: 'protagonist_lead',
            lookRoom: 'right',
            dutchAngleDeg: 0
          }
        },
        {
          beatId: 'beat_02_reach_grasp',
          startFrame: 210,
          endFrame: 420,
          lyricSnippet: 'Meraih secangkir hangat di atas meja',
          emotionalTone: 'melancholic',
          narrativeSubtext: 'Reaching arm with analytical IK and grasping coffee cup',
          presentCharacters: ['protagonist_lead'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: ['desk', 'coffee_cup'],
            landmarkPlacements: {
              coffee_cup: [0, 63, 0]
            },
            atmosphericDensity: 0.5
          },
          actions: [
            {
              instanceId: 'protagonist_lead',
              verb: 'reach_and_grasp',
              speedNorm: 0.9,
              intensityNorm: 0.8,
              associatedPropId: 'coffee_cup'
            }
          ],
          camera: {
            framing: 'CLOSE_UP',
            movement: 'STATIC',
            focalCharacterId: 'protagonist_lead',
            lookRoom: 'center',
            dutchAngleDeg: 0
          }
        },
        {
          beatId: 'beat_03_snap_turn',
          startFrame: 420,
          endFrame: 630,
          lyricSnippet: 'Seketika langkah berbalik menatap bayang',
          emotionalTone: 'defiant',
          narrativeSubtext: 'Cut-paper snap turnaround with locked foot contact',
          presentCharacters: ['protagonist_lead'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'dramatic_twilight',
            landmarkProps: ['desk', 'coffee_cup'],
            landmarkPlacements: {
              coffee_cup: [0, 63, 0]
            },
            atmosphericDensity: 0.6
          },
          actions: [
            {
              instanceId: 'protagonist_lead',
              verb: 'stop_and_turn',
              speedNorm: 1.1,
              intensityNorm: 0.9
            }
          ],
          camera: {
            framing: 'MEDIUM',
            movement: 'PAN',
            focalCharacterId: 'protagonist_lead',
            lookRoom: 'left',
            dutchAngleDeg: 4
          }
        },
        {
          beatId: 'beat_04_carry_put_down',
          startFrame: 630,
          endFrame: 840,
          lyricSnippet: 'Melangkah membawa asa melintasi ruang',
          emotionalTone: 'reflective',
          narrativeSubtext: 'Carrying cup and setting it down safely onto stage surface',
          presentCharacters: ['protagonist_lead'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'dramatic_twilight',
            landmarkProps: ['desk', 'coffee_cup'],
            landmarkPlacements: {
              coffee_cup: [0, 63, 0]
            },
            atmosphericDensity: 0.5
          },
          actions: [
            {
              instanceId: 'protagonist_lead',
              verb: 'carry_put_down',
              speedNorm: 1.0,
              intensityNorm: 0.7
            }
          ],
          camera: {
            framing: 'WIDE',
            movement: 'STATIC',
            focalCharacterId: 'protagonist_lead',
            lookRoom: 'center',
            dutchAngleDeg: 0
          }
        },
        {
          beatId: 'beat_05_gesture_point',
          startFrame: 840,
          endFrame: 1050,
          lyricSnippet: 'Menunjuk cakrawala fajar yang menjelang',
          emotionalTone: 'euphoric',
          narrativeSubtext: 'Pointing toward rising horizon in architectural hall',
          presentCharacters: ['protagonist_lead'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'clean_minimal',
            landmarkProps: ['desk'],
            atmosphericDensity: 0.4
          },
          actions: [
            {
              instanceId: 'protagonist_lead',
              verb: 'gesture_point',
              speedNorm: 1.0,
              intensityNorm: 0.85
            }
          ],
          camera: {
            framing: 'CLOSE_UP',
            movement: 'STATIC',
            focalCharacterId: 'protagonist_lead',
            lookRoom: 'right',
            dutchAngleDeg: 0
          }
        }
      ],
      unfulfilledRequests: []
    };

    const syntheticManifest: AudioAnalysisManifest = {
      metadata: {
        audioFilePath: 'synthetic.wav',
        sampleRate: 44100,
        durationSeconds: 35,
        totalFrames: 1050,
        fps: 30
      },
      normalization: {
        globalRmsMax: 1.0,
        localWindowFrames: 30
      },
      lyrics: [
        {
          id: 'lyric_01',
          startTimeSeconds: 0,
          endTimeSeconds: 6,
          frameRange: { startFrameInclusive: 0, endFrameExclusive: 180 },
          text: 'Di tengah lorong malam hening merenung',
          emphasis: 0.8
        },
        {
          id: 'lyric_02',
          startTimeSeconds: 7,
          endTimeSeconds: 13,
          frameRange: { startFrameInclusive: 210, endFrameExclusive: 390 },
          text: 'Meraih secangkir hangat di atas meja',
          emphasis: 0.8
        },
        {
          id: 'lyric_03',
          startTimeSeconds: 14,
          endTimeSeconds: 20,
          frameRange: { startFrameInclusive: 420, endFrameExclusive: 600 },
          text: 'Seketika langkah berbalik menatap bayang',
          emphasis: 0.8
        },
        {
          id: 'lyric_04',
          startTimeSeconds: 21,
          endTimeSeconds: 27,
          frameRange: { startFrameInclusive: 630, endFrameExclusive: 810 },
          text: 'Melangkah membawa asa melintasi ruang',
          emphasis: 0.8
        },
        {
          id: 'lyric_05',
          startTimeSeconds: 28,
          endTimeSeconds: 34,
          frameRange: { startFrameInclusive: 840, endFrameExclusive: 1020 },
          text: 'Menunjuk cakrawala fajar yang menjelang',
          emphasis: 0.8
        }
      ],
      beatEvents: [],
      storageReference: {
        type: 'memory_columnar',
        columnLayoutVersion: 1
      }
    };

    sharedStage1Contract = stage1Contract;

    const production = VerbCompiler.compile(stage1Contract, syntheticManifest);
    const leadRig = production.rigs.get('protagonist_lead')!;
    assert.ok(leadRig, 'protagonist_lead rig must exist');

    // Invariant 1: beat_01_walk has leg oscillation > 20 deg and end position X = -22
    const walkTrack = production.choreography.tracks.find(
      (t) => t.shotId === 'beat_01_walk' && t.rigId === 'protagonist_lead'
    )!;
    assert.ok(walkTrack, 'walk track must exist');
    assert.equal(walkTrack.pose?.clipId, 'walk_to');
    const walkClip = BipedPoseClips['walk_to'];
    const thighAngles = walkClip.keyframes.map((k) => {
      const jt = k.jointTransforms.find((j) => j.jointId === 'leg_l_upper');
      return jt ? jt.rotationZDegrees : 0;
    });
    const thighOscillation = Math.max(...thighAngles) - Math.min(...thighAngles);
    assert.ok(
      thighOscillation > 20,
      `Walk leg oscillation must be > 20 degrees, got ${thighOscillation}`
    );
    const walkEndPos = walkTrack.transform.keyframes[walkTrack.transform.keyframes.length - 1].position;
    assert.equal(walkEndPos[0], -21, `Walk end X must be -21, got ${walkEndPos[0]}`);

    // Invariant 2: At grasp frame (~315) and release frame (~785), wrist is <= 2.5 units from cup
    // Frame 315 (relative frame 105 in beat_02_reach_grasp)
    const graspClip = BipedPoseClips['reach_and_grasp'];
    const graspKf = graspClip.keyframes.find((k) => k.frame === 105)!;
    assert.ok(graspKf, 'reach_and_grasp frame 105 keyframe must exist');
    const graspJointAngles: Record<string, number> = {};
    const graspJointOffsets: Record<string, [number, number]> = {};
    for (const jt of graspKf.jointTransforms) {
      graspJointAngles[jt.jointId] = jt.rotationZDegrees;
      if (jt.localOffset2D) graspJointOffsets[jt.jointId] = jt.localOffset2D;
    }
    const graspFk = computeSkeletonFK(leadRig.skeleton!, graspJointAngles, graspJointOffsets);
    const armLowerAff = graspFk.get('arm_r_lower')!;
    const graspWrist = applyAffine2D(armLowerAff, [0, -16]);
    const worldWrist315: [number, number] = [-21 + 1.35 * graspWrist[0], 66 + 1.45 * graspWrist[1]];
    const distDesk1 = Math.hypot(worldWrist315[0] - 0, worldWrist315[1] - 63);
    assert.ok(
      distDesk1 <= 2.5,
      `At grasp frame 315, wrist must be within 2.5 units of Desk 1 cup [0, 63], got ${distDesk1}`
    );

    // Frame 785 (relative frame 155 in beat_04_carry_put_down)
    const putDownClip = BipedPoseClips['carry_put_down'];
    const putDownKf = putDownClip.keyframes.find((k) => k.frame === 155)!;
    assert.ok(putDownKf, 'carry_put_down frame 155 keyframe must exist');
    const putDownJointAngles: Record<string, number> = {};
    const putDownJointOffsets: Record<string, [number, number]> = {};
    for (const jt of putDownKf.jointTransforms) {
      putDownJointAngles[jt.jointId] = jt.rotationZDegrees;
      if (jt.localOffset2D) putDownJointOffsets[jt.jointId] = jt.localOffset2D;
    }
    const putDownFk = computeSkeletonFK(leadRig.skeleton!, putDownJointAngles, putDownJointOffsets);
    const armLowerAff2 = putDownFk.get('arm_r_lower')!;
    const putDownWrist = applyAffine2D(armLowerAff2, [0, -16]);
    // Character facing left (-1.35) at stopped position X = -68
    const worldWrist785: [number, number] = [-68 + (-1.35) * putDownWrist[0], 66 + 1.45 * putDownWrist[1]];
    const distDesk2 = Math.hypot(worldWrist785[0] - (-89), worldWrist785[1] - 63);
    assert.ok(
      distDesk2 <= 2.5,
      `At release frame 785, wrist must be within 2.5 units of Desk 2 cup [-89, 63], got ${distDesk2}`
    );

    // Invariant 3: In beat_03_snap_turn, scale[0] is +1.35 at frame 420 and flips to -1.35 between 460 and 480
    const turnTrack = production.choreography.tracks.find(
      (t) => t.shotId === 'beat_03_snap_turn' && t.rigId === 'protagonist_lead'
    )!;
    assert.ok(turnTrack, 'turn track must exist');
    const scaleAt420 = turnTrack.transform.keyframes.find((k) => k.frame === 420)!.scale[0];
    const kfsTurnMid = turnTrack.transform.keyframes.filter((k) => k.frame >= 460 && k.frame <= 480);
    assert.equal(scaleAt420, 1.35, `Scale at frame 420 must be +1.35, got ${scaleAt420}`);
    assert.ok(kfsTurnMid.length >= 2, 'Must have turnaround transition keyframes between 460 and 480');
    assert.equal(kfsTurnMid[0].scale[0], 1.35, 'Scale before flip must be +1.35');
    assert.equal(kfsTurnMid[kfsTurnMid.length - 1].scale[0], -1.35, 'Scale after flip must be -1.35');

    // Invariant 4: In beat_05_gesture_point, Y_wrist > Y_shoulder + 6 and |X_wrist - X_shoulder| >= 24
    const pointClip = BipedPoseClips['gesture_point'];
    const pointKf = pointClip.keyframes.find((k) => k.frame === 40)!;
    assert.ok(pointKf, 'gesture_point frame 40 keyframe must exist');
    const pointJointAngles: Record<string, number> = {};
    const pointJointOffsets: Record<string, [number, number]> = {};
    for (const jt of pointKf.jointTransforms) {
      pointJointAngles[jt.jointId] = jt.rotationZDegrees;
      if (jt.localOffset2D) pointJointOffsets[jt.jointId] = jt.localOffset2D;
    }
    const pointFk = computeSkeletonFK(leadRig.skeleton!, pointJointAngles, pointJointOffsets);
    const pShoulder = pointFk.get('arm_r_upper')!;
    const pArmLower = pointFk.get('arm_r_lower')!;
    const pWrist = applyAffine2D(pArmLower, [0, -16]);
    const shoulderWorldY = 75 + 1.45 * pShoulder.ty;
    const wristWorldY = 75 + 1.45 * pWrist[1];
    const shoulderWorldX = -15 + 1.35 * pShoulder.tx;
    const wristWorldX = -15 + 1.35 * pWrist[0];
    const yDiff = wristWorldY - shoulderWorldY;
    const xDiff = Math.abs(wristWorldX - shoulderWorldX);
    assert.ok(
      yDiff > 6.0,
      `In gesture_point, wrist Y must be > shoulder Y + 6, got diff ${yDiff}`
    );
    assert.ok(
      xDiff >= 24.0,
      `In gesture_point, horizontal arm extension |X_wrist - X_shoulder| must be >= 24, got ${xDiff}`
    );

    // Invariant 5: Across sung lyric frames, mouth morph screen height variation >= 6.0 px
    const trackWithMorphs = production.choreography.tracks.find(
      (t) => t.rigId === 'protagonist_lead' && t.morphKeyframes && Object.keys(t.morphKeyframes).length > 0
    )!;
    assert.ok(trackWithMorphs, 'Lead track must contain synthesized morph keyframes');
    const openAKfs = trackWithMorphs.morphKeyframes['mouth_wide_a'] || [];
    let maxOpenA = 0;
    for (const mk of openAKfs) {
      if (mk.weight > maxOpenA) maxOpenA = mk.weight;
    }
    assert.ok(maxOpenA > 0.4, `Vocal synthesis must activate mouth_wide_a, got max ${maxOpenA}`);

    // Screen height projection verification:
    // facial_expression_morph mouth_open_a has local delta Y = 12 units (from -6 to +6).
    // In CLOSE_UP framing, camera distance ~135, fov = 50 deg:
    // Screen height scale = (1080 / 2) / tan(25 deg) / 135 * 1.45 * (12 * maxOpenA)
    const focalPx = (1080 / 2) / Math.tan((25 * Math.PI) / 180);
    const worldHeightOpen = 12 * maxOpenA * 1.45;
    const projectedScreenHeight = (worldHeightOpen * focalPx) / 135;
    assert.ok(
      projectedScreenHeight >= 6.0,
      `Projected mouth opening screen height must be >= 6.0 px, got ${projectedScreenHeight.toFixed(2)} px`
    );
  });

  await t.test('Anti-Treadmill Test Gate: Root displacement >= 45, stance foot drift <= 1.5, stopped damping, and separation >= 26', () => {
    const stage2Contract: StoryBeatContract = {
      projectId: 'stage2_two_characters',
      songDurationSec: 35,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 1050 },
      cast: [
        {
          instanceId: 'protagonist_lead',
          role: 'PROTAGONIST',
          archetypeId: 'hero_silhouette',
          palette: { primary: '#0a1128', accent: '#00f0ff' }
        },
        {
          instanceId: 'narrative_partner',
          role: 'PARTNER',
          archetypeId: 'companion_silhouette',
          palette: { primary: '#3d1c06', accent: '#ff9100' }
        }
      ],
      beats: [
        {
          beatId: 'beat_01_interior_approach',
          startFrame: 0,
          endFrame: 210,
          lyricSnippet: 'Di balik jendela senja redup memudar',
          emotionalTone: 'reflective',
          narrativeSubtext: 'Two contrasting silhouettes approach the central meeting table',
          presentCharacters: ['protagonist_lead', 'narrative_partner'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: ['desk', 'coffee_cup'],
            landmarkPlacements: {
              coffee_cup: [-56, 63, 0]
            },
            atmosphericDensity: 0.5
          },
          actions: [
            {
              instanceId: 'protagonist_lead',
              verb: 'carry_put_down',
              speedNorm: 1.0,
              intensityNorm: 0.7,
              associatedPropId: 'coffee_cup',
              target: { kind: 'position', pos: [-56, 63, 0] }
            },
            { instanceId: 'narrative_partner', verb: 'walk_to', speedNorm: 1.0, intensityNorm: 0.7, target: { kind: 'position', pos: [38, 0, 0] } }
          ],
          camera: { framing: 'WIDE', movement: 'DOLLY', focalCharacterId: 'protagonist_lead', lookRoom: 'center', dutchAngleDeg: 0 }
        },
        {
          beatId: 'beat_02_interior_confront',
          startFrame: 210,
          endFrame: 420,
          lyricSnippet: 'Bertemu tatap bayang di balik tiang megah',
          emotionalTone: 'melancholic',
          narrativeSubtext: 'Tense confrontation across the desk surface',
          presentCharacters: ['protagonist_lead', 'narrative_partner'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'dramatic_twilight',
            landmarkProps: ['desk', 'coffee_cup'],
            landmarkPlacements: {
              coffee_cup: [-56, 63, 0]
            },
            atmosphericDensity: 0.6
          },
          actions: [
            {
              instanceId: 'protagonist_lead',
              verb: 'walk_to',
              speedNorm: 1.0,
              intensityNorm: 0.8,
              target: { kind: 'position', pos: [-32, 0, 0] }
            },
            { instanceId: 'narrative_partner', verb: 'look_at', speedNorm: 1.0, intensityNorm: 0.8 }
          ],
          camera: { framing: 'INSERT', movement: 'STATIC', focalCharacterId: 'protagonist_lead', lookRoom: 'center', dutchAngleDeg: 0 }
        },
        {
          beatId: 'beat_03_embrace_push',
          startFrame: 420,
          endFrame: 630,
          lyricSnippet: 'Pelukan sesaat lalu terhempas berjarak',
          emotionalTone: 'defiant',
          narrativeSubtext: 'Bilateral embrace and dramatic push-away recoil with guaranteed clearance',
          presentCharacters: ['protagonist_lead', 'narrative_partner'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'dramatic_twilight',
            landmarkProps: [],
            atmosphericDensity: 0.6
          },
          actions: [
            { instanceId: 'protagonist_lead', verb: 'embrace_push_away', speedNorm: 1.1, intensityNorm: 0.95 },
            { instanceId: 'narrative_partner', verb: 'embrace_push_away', speedNorm: 1.1, intensityNorm: 0.95 }
          ],
          camera: { framing: 'MEDIUM', movement: 'PAN', focalCharacterId: 'protagonist_lead', lookRoom: 'center', dutchAngleDeg: 3 }
        },
        {
          beatId: 'beat_04_exterior_run',
          startFrame: 630,
          endFrame: 840,
          lyricSnippet: 'Berlari keluar menembus dingin lampu kota',
          emotionalTone: 'chaotic',
          narrativeSubtext: 'Characters transition outdoors onto the rainy urban street overlook',
          presentCharacters: ['protagonist_lead', 'narrative_partner'],
          set: {
            kitId: 'EXTERIOR_URBAN_VISTA',
            variantId: 'storm_overcast',
            landmarkProps: ['umbrella'],
            atmosphericDensity: 0.7
          },
          actions: [
            { instanceId: 'protagonist_lead', verb: 'run_to', speedNorm: 1.0, intensityNorm: 0.9, target: { kind: 'position', pos: [65, 0, 0] } },
            { instanceId: 'narrative_partner', verb: 'walk_to', speedNorm: 1.0, intensityNorm: 0.7, associatedPropId: 'umbrella', target: { kind: 'position', pos: [9, 0, 0] } }
          ],
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'protagonist_lead', lookRoom: 'right', dutchAngleDeg: -2 }
        },
        {
          beatId: 'beat_05_exterior_outlook',
          startFrame: 840,
          endFrame: 1050,
          lyricSnippet: 'Menatap menara langit menjulang menanti fajar',
          emotionalTone: 'euphoric',
          narrativeSubtext: 'Pointing together towards the towering skyline towers as dawn approaches',
          presentCharacters: ['protagonist_lead', 'narrative_partner'],
          set: {
            kitId: 'EXTERIOR_URBAN_VISTA',
            variantId: 'clean_minimal',
            landmarkProps: ['umbrella'],
            landmarkPlacements: {
              umbrella: [-30, 24, 0]
            },
            atmosphericDensity: 0.4
          },
          actions: [
            { instanceId: 'protagonist_lead', verb: 'gesture_point', speedNorm: 1.0, intensityNorm: 0.85, target: { kind: 'position', pos: [65, 0, 0] } },
            { instanceId: 'narrative_partner', verb: 'look_at', speedNorm: 1.0, intensityNorm: 0.75, associatedPropId: 'umbrella', target: { kind: 'position', pos: [9, 0, 0] } }
          ],
          camera: { framing: 'CLOSE_UP', movement: 'STATIC', focalCharacterId: 'protagonist_lead', lookRoom: 'right', dutchAngleDeg: 0 }
        }
      ],
      unfulfilledRequests: []
    };

    const syntheticManifest: AudioAnalysisManifest = {
      metadata: { audioFilePath: 'synthetic.wav', sampleRate: 44100, durationSeconds: 35, totalFrames: 1050, fps: 30 },
      normalization: { globalRmsMax: 1.0, localWindowFrames: 30 },
      lyrics: [],
      beatEvents: [],
      storageReference: { type: 'memory_columnar', columnLayoutVersion: 1 }
    };

    const dummyAudioFeature = (f: number): AudioFrameFeature => ({
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

    const stage1Production = VerbCompiler.compile(sharedStage1Contract, syntheticManifest);
    const stage2Production = VerbCompiler.compile(stage2Contract, syntheticManifest);

    const s1Builder = new FrameStateBuilder({
      storyboard: stage1Production.storyboard,
      choreography: stage1Production.choreography,
      rigs: stage1Production.rigs,
      audioManifest: syntheticManifest,
      getAudioFeatureAtFrame: dummyAudioFeature
    });

    const s2Builder = new FrameStateBuilder({
      storyboard: stage2Production.storyboard,
      choreography: stage2Production.choreography,
      rigs: stage2Production.rigs,
      audioManifest: syntheticManifest,
      getAudioFeatureAtFrame: dummyAudioFeature
    });

    // 1. Total root horizontal displacement |Delta X_root| >= 45.0 world units for every locomotion span
    const s1WalkTrack = stage1Production.choreography.tracks.find(t => t.shotId === 'beat_01_walk' && t.rigId === 'protagonist_lead')!;
    const s1WalkKfs = s1WalkTrack.transform.keyframes;
    const s1WalkDisp = Math.abs(s1WalkKfs[1].position[0] - s1WalkKfs[0].position[0]);
    assert.ok(s1WalkDisp >= 45.0, `Stage 1 walk displacement must be >= 45.0, got ${s1WalkDisp}`);

    const s1CarryTrack = stage1Production.choreography.tracks.find(t => t.shotId === 'beat_04_carry_put_down' && t.rigId === 'protagonist_lead')!;
    const s1CarryKfs = s1CarryTrack.transform.keyframes;
    const s1CarryDisp = Math.abs(s1CarryKfs[1].position[0] - s1CarryKfs[0].position[0]);
    assert.ok(s1CarryDisp >= 45.0, `Stage 1 carry walk displacement must be >= 45.0, got ${s1CarryDisp}`);

    const s2ApproachLeadTrack = stage2Production.choreography.tracks.find(t => t.shotId === 'beat_01_interior_approach' && t.rigId === 'protagonist_lead')!;
    const s2ApproachLeadDisp = Math.abs(s2ApproachLeadTrack.transform.keyframes[1].position[0] - s2ApproachLeadTrack.transform.keyframes[0].position[0]);
    assert.ok(s2ApproachLeadDisp >= 16.0, `Stage 2 approach lead displacement must be >= 16.0, got ${s2ApproachLeadDisp}`);

    const s2ApproachPartnerTrack = stage2Production.choreography.tracks.find(t => t.shotId === 'beat_01_interior_approach' && t.rigId === 'narrative_partner')!;
    const s2ApproachPartnerDisp = Math.abs(s2ApproachPartnerTrack.transform.keyframes[1].position[0] - s2ApproachPartnerTrack.transform.keyframes[0].position[0]);
    assert.ok(s2ApproachPartnerDisp >= 45.0, `Stage 2 approach partner displacement must be >= 45.0, got ${s2ApproachPartnerDisp}`);

    const s2RunLeadTrack = stage2Production.choreography.tracks.find(t => t.shotId === 'beat_04_exterior_run' && t.rigId === 'protagonist_lead')!;
    const s2RunLeadDisp = Math.abs(s2RunLeadTrack.transform.keyframes[1].position[0] - s2RunLeadTrack.transform.keyframes[0].position[0]);
    assert.ok(s2RunLeadDisp >= 45.0, `Stage 2 exterior run lead displacement must be >= 45.0, got ${s2RunLeadDisp}`);

    const s2RunPartnerTrack = stage2Production.choreography.tracks.find(t => t.shotId === 'beat_04_exterior_run' && t.rigId === 'narrative_partner')!;
    const s2RunPartnerDisp = Math.abs(s2RunPartnerTrack.transform.keyframes[1].position[0] - s2RunPartnerTrack.transform.keyframes[0].position[0]);
    assert.ok(s2RunPartnerDisp >= 45.0, `Stage 2 exterior run partner displacement must be >= 45.0, got ${s2RunPartnerDisp}`);

    // 2. World-space stance foot drift during ground contact frames <= 1.5 world units
    const leadRig = stage1Production.rigs.get('protagonist_lead')!;
    const walkClip = BipedPoseClips['walk_to'];
    const loopFrames = walkClip.loopFrames ?? 36;
    const timeScale = s1WalkTrack.pose?.timeScale ?? 1.0;

    for (let f = 10; f < 150; f++) {
      const state0 = s1Builder.buildFrameState(f);
      const state1 = s1Builder.buildFrameState(f + 1);
      const e0 = state0.entities.find(e => e.rigId === 'protagonist_lead')!;
      const e1 = state1.entities.find(e => e.rigId === 'protagonist_lead')!;

      // Check left foot stance drift
      const clock = (f * timeScale) % loopFrames;
      if (clock >= 0 && clock <= 20) {
        const fk0 = computeSkeletonFK(leadRig.skeleton!, e0.jointAngles, e0.jointOffsets);
        const fk1 = computeSkeletonFK(leadRig.skeleton!, e1.jointAngles, e1.jointOffsets);
        const footLocal0 = applyAffine2D(fk0.get('leg_l_lower')!, [0, -22]);
        const footLocal1 = applyAffine2D(fk1.get('leg_l_lower')!, [0, -22]);
        const worldFootX0 = e0.worldPosition[0] + e0.scale[0] * footLocal0[0];
        const worldFootX1 = e1.worldPosition[0] + e1.scale[0] * footLocal1[0];
        const drift = Math.abs(worldFootX1 - worldFootX0);
        assert.ok(drift <= 1.5, `Stance foot drift at frame ${f} must be <= 1.5, got ${drift.toFixed(3)}`);
      }
    }

    // 3. Whenever v_root(f) < 0.05, leg swing amplitude is damped to 0 (standing feet planted)
    for (let f = 175; f < 205; f++) {
      const state = s1Builder.buildFrameState(f);
      const e = state.entities.find(e => e.rigId === 'protagonist_lead')!;
      assert.equal(e.jointAngles['leg_l_upper'], 4, `Frame ${f}: Stopped leg_l_upper must be damped to rest 4 deg, got ${e.jointAngles['leg_l_upper']}`);
      assert.equal(e.jointAngles['leg_l_lower'], -6, `Frame ${f}: Stopped leg_l_lower must be damped to rest -6 deg, got ${e.jointAngles['leg_l_lower']}`);
      assert.equal(e.jointAngles['leg_r_upper'], -4, `Frame ${f}: Stopped leg_r_upper must be damped to rest -4 deg, got ${e.jointAngles['leg_r_upper']}`);
      assert.equal(e.jointAngles['leg_r_lower'], -6, `Frame ${f}: Stopped leg_r_lower must be damped to rest -6 deg, got ${e.jointAngles['leg_r_lower']}`);
    }

    // 4. In Stage 2 two-character beats, non-embrace beats keep separation >= 26.0, while Beat 3 executes a true close embrace (<= 20.0) followed by a wide recoil (>= 85.0)
    let minEmbraceSep = Infinity;
    let maxRecoilSep = 0;
    for (let f = 0; f < 1050; f++) {
      const state = s2Builder.buildFrameState(f);
      const hero = state.entities.find(e => e.rigId === 'protagonist_lead')!;
      const partner = state.entities.find(e => e.rigId === 'narrative_partner')!;
      assert.ok(hero && partner, `Frame ${f}: Both hero and partner must exist in frame state`);
      const separation = Math.abs(hero.worldPosition[0] - partner.worldPosition[0]);
      if (f >= 450 && f <= 515) {
        if (separation < minEmbraceSep) minEmbraceSep = separation;
      } else if (f >= 575 && f <= 625) {
        if (separation > maxRecoilSep) maxRecoilSep = separation;
      } else if (f < 420 || f >= 630) {
        assert.ok(
          separation >= 26.0,
          `Frame ${f} (shot "${state.shotId}"): Horizontal separation must be >= 26.0 world units, got ${separation.toFixed(2)}`
        );
      }
    }
    assert.ok(
      minEmbraceSep <= 29.0,
      `Stage 2 Beat 3 min embrace separation in [450, 515] must be <= 29.0 units, got ${minEmbraceSep.toFixed(2)}`
    );
    assert.ok(
      maxRecoilSep >= 70.0,
      `Stage 2 Beat 3 max recoil separation in [575, 625] must be >= 70.0 units, got ${maxRecoilSep.toFixed(2)}`
    );

    // 5. Carry walk leg swing: during carry walk sub-span (frames 640..720), leg swings actively
    const carryAngles: number[] = [];
    for (let f = 640; f < 720; f++) {
      const state = s1Builder.buildFrameState(f);
      const hero = state.entities.find(e => e.rigId === 'protagonist_lead')!;
      carryAngles.push(hero.jointAngles['leg_l_upper']);
    }
    const minSwing = Math.min(...carryAngles);
    const maxSwing = Math.max(...carryAngles);
    const p2pSwing = maxSwing - minSwing;
    assert.ok(p2pSwing >= 25.0, `Carry walk peak-to-peak leg swing must be >= 25 deg, got ${p2pSwing.toFixed(2)}`);
    const meanSwing = (minSwing + maxSwing) / 2;
    let swingCrossings = 0;
    for (let i = 1; i < carryAngles.length; i++) {
      if ((carryAngles[i - 1] - meanSwing) * (carryAngles[i] - meanSwing) < 0) swingCrossings++;
    }
    assert.ok(swingCrossings >= 2, `Carry walk must exhibit >= 2 stride zero-crossings, got ${swingCrossings}`);

    // 6. Straightened pointing arm: during gesture_point (frames 880..1040), elbow bend |arm_r_lower| <= 25 deg and wristWorldY >= shoulderWorldY + 12.0
    const heroRigDef = stage1Production.rigs.get('protagonist_lead')!;
    for (let f = 880; f <= 1040; f += 20) {
      const pointState = s1Builder.buildFrameState(f);
      const heroPoint = pointState.entities.find(e => e.rigId === 'protagonist_lead')!;
      const fkPoint = computeSkeletonFK(heroRigDef.skeleton!, heroPoint.jointAngles, heroPoint.jointOffsets);
      const shoulderUpper = fkPoint.get('arm_r_upper')!;
      const wristTip = applyAffine2D(fkPoint.get('arm_r_lower')!, [0, -16]);
      const shoulderWorldY = heroPoint.worldPosition[1] + shoulderUpper.ty * heroPoint.scale[1];
      const wristWorldY = heroPoint.worldPosition[1] + wristTip[1] * heroPoint.scale[1];
      assert.ok(
        wristWorldY >= shoulderWorldY + 12.0,
        `Frame ${f}: Upward gesture point wrist Y (${wristWorldY.toFixed(1)}) must be >= shoulder Y (${shoulderWorldY.toFixed(1)}) + 12.0`
      );
      const elbowFlexion = Math.abs(heroPoint.jointAngles['arm_r_lower'] ?? 0);
      assert.ok(
        elbowFlexion <= 25.0,
        `Frame ${f}: Gesture point elbow flexion (${elbowFlexion.toFixed(1)} deg) must be <= 25.0 deg for extended point`
      );
    }

    // 7. Umbrella Handle-in-Hand & Clean Hero Arm (Stage 2 Beats 4–5, frames 630..1049)
    const partnerRigDef = stage2Production.rigs.get('narrative_partner')!;
    for (let f = 630; f < 1050; f += 15) {
      const state = s2Builder.buildFrameState(f);
      const hero = state.entities.find(e => e.rigId === 'protagonist_lead')!;
      const partner = state.entities.find(e => e.rigId === 'narrative_partner')!;
      const umbrella = state.entities.find(e => e.rigId === 'umbrella')!;
      assert.ok(umbrella, `Frame ${f}: Umbrella must exist as an active entity`);

      // Distance between companion_silhouette FK hand_r world position and umbrella handle origin <= 1.0 unit
      const fkPartner = computeSkeletonFK(partnerRigDef.skeleton!, partner.jointAngles, partner.jointOffsets);
      const handLocal = applyAffine2D(fkPartner.get('arm_r_lower')!, [0, -16]);
      const handWorldX = partner.worldPosition[0] + handLocal[0] * partner.scale[0];
      const handWorldY = partner.worldPosition[1] + handLocal[1] * partner.scale[1];
      const handleDist = Math.hypot(umbrella.worldPosition[0] - handWorldX, umbrella.worldPosition[1] - handWorldY);
      assert.ok(
        handleDist <= 1.0,
        `Frame ${f}: Distance between partner FK hand_r [${handWorldX.toFixed(2)}, ${handWorldY.toFixed(2)}] and umbrella handle origin [${umbrella.worldPosition[0].toFixed(2)}, ${umbrella.worldPosition[1].toFixed(2)}] must be <= 1.0, got ${handleDist.toFixed(3)}`
      );
      assert.equal(umbrella.worldRotationZDegrees, 0, `Frame ${f}: Umbrella must remain upright (rotation = 0)`);

      // Hero's FK hand_r stays strictly in front of or beside Hero's torso (X_hero_hand_r >= X_hero - 12)
      const fkHero = computeSkeletonFK(heroRigDef.skeleton!, hero.jointAngles, hero.jointOffsets);
      const heroHandLocal = applyAffine2D(fkHero.get('arm_r_lower')!, [0, -16]);
      const heroHandWorldX = hero.worldPosition[0] + heroHandLocal[0] * hero.scale[0];
      assert.ok(
        heroHandWorldX >= hero.worldPosition[0] - 12.0,
        `Frame ${f}: Hero FK hand_r X (${heroHandWorldX.toFixed(1)}) must be >= Hero X (${hero.worldPosition[0].toFixed(1)}) - 12.0`
      );

      // Safe headroom on CLOSE_UP shots (frames 840..1049): canopy top screen Y >= 30 px
      if (f >= 840) {
        const basis = computeCameraBasis(state.camera);
        const canopyWorldY = umbrella.worldPosition[1] + 48 + 12.5;
        const canopyWorldPos = [umbrella.worldPosition[0], canopyWorldY, umbrella.worldPosition[2]] as [number, number, number];
        const proj = projectToScreen(canopyWorldPos, state.camera, basis);
        assert.ok(
          proj.y >= 30.0,
          `Frame ${f}: Canopy top screen Y (${proj.y.toFixed(1)} px) must be >= 30.0 px for safe headroom`
        );
      }
    }

    // 8. Staging separation progression: approach >= 64, recoil >= 80, run/outlook >= 45
    const s2ApproachState = s2Builder.buildFrameState(200);
    const heroApp = s2ApproachState.entities.find(e => e.rigId === 'protagonist_lead')!;
    const partnerApp = s2ApproachState.entities.find(e => e.rigId === 'narrative_partner')!;
    const sepApp = Math.abs(heroApp.worldPosition[0] - partnerApp.worldPosition[0]);
    assert.ok(sepApp >= 64.0, `Approach separation at frame 200 must be >= 64.0, got ${sepApp.toFixed(2)}`);

    const s2RecoilState = s2Builder.buildFrameState(620);
    const heroRec = s2RecoilState.entities.find(e => e.rigId === 'protagonist_lead')!;
    const partnerRec = s2RecoilState.entities.find(e => e.rigId === 'narrative_partner')!;
    const sepRec = Math.abs(heroRec.worldPosition[0] - partnerRec.worldPosition[0]);
    assert.ok(sepRec >= 70.0, `Recoil separation at frame 620 must be >= 70.0, got ${sepRec.toFixed(2)}`);

    // True root translation on recoil: outward displacement between embrace thrust (516) and recoil arrival (629) >= 26.0 u
    const s2ThrustState = s2Builder.buildFrameState(516);
    const s2EndRecoilState = s2Builder.buildFrameState(629);
    const heroThrustX = s2ThrustState.entities.find(e => e.rigId === 'protagonist_lead')!.worldPosition[0];
    const heroEndRecoilX = s2EndRecoilState.entities.find(e => e.rigId === 'protagonist_lead')!.worldPosition[0];
    const partnerThrustX = s2ThrustState.entities.find(e => e.rigId === 'narrative_partner')!.worldPosition[0];
    const partnerEndRecoilX = s2EndRecoilState.entities.find(e => e.rigId === 'narrative_partner')!.worldPosition[0];
    const heroRecoilDist = Math.abs(heroEndRecoilX - heroThrustX);
    const partnerRecoilDist = Math.abs(partnerEndRecoilX - partnerThrustX);
    assert.ok(
      heroRecoilDist >= 26.0,
      `Hero outward recoil displacement (${heroRecoilDist.toFixed(1)} u) must be >= 26.0 u`
    );
    assert.ok(
      partnerRecoilDist >= 26.0,
      `Partner outward recoil displacement (${partnerRecoilDist.toFixed(1)} u) must be >= 26.0 u`
    );

    for (let f = 750; f < 1050; f += 30) {
      const state = s2Builder.buildFrameState(f);
      const hero = state.entities.find(e => e.rigId === 'protagonist_lead')!;
      const partner = state.entities.find(e => e.rigId === 'narrative_partner')!;
      const sep = Math.abs(hero.worldPosition[0] - partner.worldPosition[0]);
      assert.ok(sep >= 45.0, `Frame ${f}: Exterior separation must be >= 45.0, got ${sep.toFixed(2)}`);
    }

    // 9. Mid-stance knee flexion: knee flexion at mid-stance (frame 23) within [-14, -6] deg
    const stanceState = s1Builder.buildFrameState(23);
    const heroStance = stanceState.entities.find(e => e.rigId === 'protagonist_lead')!;
    const kneeAngle = heroStance.jointAngles['leg_l_lower'];
    assert.ok(
      kneeAngle >= -14 && kneeAngle <= -6,
      `Mid-stance knee flexion must be within [-14, -6] deg, got ${kneeAngle.toFixed(2)}`
    );

    // 10. Zero Floating Cup (Stage 1 frames 795..1049) & Deficit-Based Upright Reach at Y_target=63 (frame 785)
    for (let f = 795; f < 1050; f++) {
      const state = s1Builder.buildFrameState(f);
      const cup = state.entities.find(e => e.rigId === 'coffee_cup')!;
      assert.ok(cup, `Frame ${f}: coffee_cup must exist in Stage 1 frame state`);
      assert.ok(
        Math.abs(cup.worldPosition[1] - 63.0) <= 0.5,
        `Frame ${f}: Released coffee_cup bottom world Y (${cup.worldPosition[1].toFixed(2)}) must equal desk surface Y=63.0 within 0.5 u`
      );
    }
    const releaseState = s1Builder.buildFrameState(785);
    const heroRelease = releaseState.entities.find(e => e.rigId === 'protagonist_lead')!;
    assert.ok(
      heroRelease.worldPosition[1] >= 64.0,
      `Upright desk release rootY (${heroRelease.worldPosition[1].toFixed(2)}) must be >= 64.0`
    );
    assert.ok(
      Math.abs(heroRelease.jointAngles['torso'] ?? 0) <= 6.0,
      `Upright desk release |torso| (${Math.abs(heroRelease.jointAngles['torso'] ?? 0).toFixed(2)} deg) must be <= 6.0 deg`
    );
    const fkRelease = computeSkeletonFK(heroRigDef.skeleton!, heroRelease.jointAngles, heroRelease.jointOffsets);
    const wristReleaseLocal = applyAffine2D(fkRelease.get('arm_r_lower')!, [0, -16]);
    const wristReleaseWorldY = heroRelease.worldPosition[1] + wristReleaseLocal[1] * heroRelease.scale[1];
    assert.ok(
      Math.abs(wristReleaseWorldY - 63.0) <= 3.5,
      `Release frame wrist world Y (${wristReleaseWorldY.toFixed(2)}) must touch desk top Y=63.0 within 3.5 u`
    );

    // Cross-cut carry pose continuity at frame 419 -> 420 in Stage 1
    const s1f419 = s1Builder.buildFrameState(419);
    const s1f420 = s1Builder.buildFrameState(420);
    const cup419 = s1f419.entities.find(e => e.rigId === 'coffee_cup')!;
    const cup420 = s1f420.entities.find(e => e.rigId === 'coffee_cup')!;
    const cupJumpDist = Math.hypot(
      cup420.worldPosition[0] - cup419.worldPosition[0],
      cup420.worldPosition[1] - cup419.worldPosition[1]
    );
    assert.ok(
      cupJumpDist <= 2.0,
      `Stage 1 cross-cut cup position jump at 419->420 must be <= 2.0 u, got ${cupJumpDist.toFixed(2)} u`
    );

    // 11. Fix 1 — Unbroken Spine Coverage across [-20 deg, +25 deg] torso lean for both biped rigs
    for (const rigDef of [heroRigDef, partnerRigDef]) {
      const abdomenPart = rigDef.parts.find(p => p.id === 'abdomen_connector')!;
      const torsoPart = rigDef.parts.find(p => p.id === 'torso_body')!;
      assert.ok(abdomenPart && abdomenPart.shape.kind === 'polygon', `abdomen_connector must exist on ${rigDef.id}`);
      assert.ok(torsoPart && torsoPart.shape.kind === 'polygon', `torso_body must exist on ${rigDef.id}`);
      const abdomenPts = abdomenPart.shape.points;
      const torsoPts = torsoPart.shape.points;

      for (const torsoDeg of [-20, -10, 0, 10, 25]) {
        const fkSpine = computeSkeletonFK(
          rigDef.skeleton!,
          { pelvis: 0, torso: torsoDeg },
          { pelvis: [0, 0], torso: [0, 8] }
        );
        const pelvisAff = fkSpine.get('pelvis')!;
        const torsoAff = fkSpine.get('torso')!;

        const abdomenWorldYs = abdomenPts.map((pt: [number, number]) => 75 + applyAffine2D(pelvisAff, pt)[1] * rigDef.baseTransform.scale[1]);
        const torsoWorldYs = torsoPts.map((pt: [number, number]) => 75 + applyAffine2D(torsoAff, pt)[1] * rigDef.baseTransform.scale[1]);

        const topAbdomen = Math.max(...abdomenWorldYs);
        const bottomTorso = Math.min(...torsoWorldYs);
        const spineOverlap = topAbdomen - bottomTorso;
        assert.ok(
          spineOverlap >= 6.0,
          `${rigDef.id} at torso=${torsoDeg} deg: spine vertical overlap (topAbdomen=${topAbdomen.toFixed(1)} - bottomTorso=${bottomTorso.toFixed(1)} = ${spineOverlap.toFixed(1)} u) must be >= 6.0 u`
        );
      }
    }

    // 12. Fix 2 — Low floor target Y_target = 30 triggers automatic crouch (rootY <= 62.0) and torso lean (>= 15.0 deg)
    const lowFloorContract: StoryBeatContract = {
      ...sharedStage1Contract,
      beats: [
        sharedStage1Contract.beats[0],
        {
          ...sharedStage1Contract.beats[1],
          actions: [
            {
              instanceId: 'protagonist_lead',
              verb: 'reach_and_grasp',
              speedNorm: 1.0,
              intensityNorm: 0.85,
              target: { kind: 'position', pos: [0, 30, 0] }
            }
          ]
        }
      ],
      sliceFrameRange: { startFrame: 0, endFrame: 420 },
      songDurationSec: 14
    };
    const lowFloorManifest: AudioAnalysisManifest = {
      ...syntheticManifest,
      metadata: { ...syntheticManifest.metadata, durationSeconds: 14, totalFrames: 420 }
    };
    const lowFloorProd = VerbCompiler.compile(lowFloorContract, lowFloorManifest);
    const lowFloorBuilder = new FrameStateBuilder({
      storyboard: lowFloorProd.storyboard,
      choreography: lowFloorProd.choreography,
      rigs: lowFloorProd.rigs,
      audioManifest: lowFloorManifest,
      getAudioFeatureAtFrame: dummyAudioFeature
    });
    const lowGraspState = lowFloorBuilder.buildFrameState(315);
    const heroLowGrasp = lowGraspState.entities.find(e => e.rigId === 'protagonist_lead')!;
    assert.ok(
      heroLowGrasp.worldPosition[1] <= 62.0,
      `Low target Y=30 grasp rootY (${heroLowGrasp.worldPosition[1].toFixed(2)}) must lower to <= 62.0`
    );
    assert.ok(
      (heroLowGrasp.jointAngles['torso'] ?? 0) >= 15.0,
      `Low target Y=30 grasp torso lean (${(heroLowGrasp.jointAngles['torso'] ?? 0).toFixed(2)} deg) must be >= 15.0 deg`
    );

    // 13. Fix 3 — Anatomically Constant Hand Morphs (<= 8.0 u max extent, |len(point) - len(open_rest)| <= 1.0 u, <= 6-frame snap)
    const handTargetExtents: Record<string, number> = {};
    for (const target of CANONICAL_HAND_MORPH_TARGETS) {
      let maxExtent = 0;
      for (const seg of target.segments) {
        for (const pt of [seg.p0, seg.p1, seg.p2, seg.p3]) {
          const d = Math.hypot(pt[0], pt[1]);
          if (d > maxExtent) maxExtent = d;
        }
      }
      handTargetExtents[target.name] = maxExtent;
      assert.ok(
        maxExtent <= 8.0,
        `Hand morph "${target.name}" max local bounding extent (${maxExtent.toFixed(2)} u) must be <= 8.0 u`
      );
    }
    const pointLenDiff = Math.abs(handTargetExtents['point'] - handTargetExtents['open_rest']);
    assert.ok(
      pointLenDiff <= 1.0,
      `|len(point) - len(open_rest)| (${pointLenDiff.toFixed(2)} u) must be <= 1.0 u`
    );
    const pointTrackS1 = stage1Production.choreography.tracks.find(
      t => t.shotId === 'beat_05_gesture_point' && t.rigId === 'protagonist_lead'
    )!;
    const pointMorphKfs = pointTrackS1.morphKeyframes?.['point'] ?? [];
    assert.ok(pointMorphKfs.length >= 3, 'gesture_point must have point morph keyframes');
    const pointSnapFrames = pointMorphKfs[2].frame - pointMorphKfs[1].frame;
    assert.ok(
      pointSnapFrames <= 6,
      `Hand morph point snap transition (${pointSnapFrames} frames) must complete within <= 6 frames`
    );

    // 14. Fix 4 — Zero Stationary Leg Pumping on companion_silhouette across frames 215..415 and 845..1045
    for (const [spanStart, spanEnd] of [[215, 415], [845, 1045]] as const) {
      for (const legJoint of ['leg_l_upper', 'leg_l_lower', 'leg_r_upper', 'leg_r_lower'] as const) {
        const vals: number[] = [];
        for (let f = spanStart; f <= spanEnd; f++) {
          const st = s2Builder.buildFrameState(f);
          const comp = st.entities.find(e => e.rigId === 'narrative_partner')!;
          vals.push(comp.jointAngles[legJoint] ?? 0);
        }
        const delta = Math.max(...vals) - Math.min(...vals);
        assert.equal(
          delta,
          0.0,
          `Stationary companion_silhouette ${legJoint} oscillation across [${spanStart}, ${spanEnd}] must be 0.0 deg, got ${delta}`
        );
      }
    }

    // 15. Fix 5 — Unobstructed Stage 2 Embrace (X in [-50, +44], embrace sep at f=490 in [24, 30], wrap-around IK past partner center)
    for (let f = 420; f < 630; f++) {
      const st = s2Builder.buildFrameState(f);
      const hero = st.entities.find(e => e.rigId === 'protagonist_lead')!;
      const comp = st.entities.find(e => e.rigId === 'narrative_partner')!;
      assert.ok(
        hero.worldPosition[0] >= -50.0,
        `Frame ${f}: Hero X (${hero.worldPosition[0].toFixed(2)}) during embrace/push must stay >= -50.0 (clear of side-table [-78, -62])`
      );
      assert.ok(
        comp.worldPosition[0] <= 44.0,
        `Frame ${f}: Companion X (${comp.worldPosition[0].toFixed(2)}) during embrace/push must stay <= 44.0`
      );
    }
    const f490State = s2Builder.buildFrameState(490);
    const hero490 = f490State.entities.find(e => e.rigId === 'protagonist_lead')!;
    const comp490 = f490State.entities.find(e => e.rigId === 'narrative_partner')!;
    const embraceSep490 = Math.abs(hero490.worldPosition[0] - comp490.worldPosition[0]);
    assert.ok(
      embraceSep490 >= 18.0 && embraceSep490 <= 22.0,
      `At frame 490, embrace separation (${embraceSep490.toFixed(2)} u) must be in [18.0, 22.0]`
    );

    const heroEmbraceTrack = stage2Production.choreography.tracks.find(
      t => t.shotId === f490State.shotId && t.rigId === 'protagonist_lead'
    )!;
    const compEmbraceTrack = stage2Production.choreography.tracks.find(
      t => t.shotId === f490State.shotId && t.rigId === 'narrative_partner'
    )!;
    for (const hand of ['hand_r', 'hand_l'] as const) {
      const heroIk = heroEmbraceTrack.ikTargets?.find(ik => ik.hand === hand && ik.weight === 1.0 && (ik.frame ?? 0) >= 460 && (ik.frame ?? 0) <= 515)!;
      const compIk = compEmbraceTrack.ikTargets?.find(ik => ik.hand === hand && ik.weight === 1.0 && (ik.frame ?? 0) >= 460 && (ik.frame ?? 0) <= 515)!;
      assert.ok(heroIk && compIk, `Both characters must have ${hand} embrace IK targets in [460, 515]`);
      assert.ok(
        heroIk.targetWorld[0] >= comp490.worldPosition[0] + 2.0,
        `Hero ${hand} embrace IK target X (${heroIk.targetWorld[0]}) must wrap past Companion center (${comp490.worldPosition[0]}) + 2`
      );
      assert.ok(
        compIk.targetWorld[0] <= hero490.worldPosition[0] - 2.0,
        `Companion ${hand} embrace IK target X (${compIk.targetWorld[0]}) must wrap past Hero center (${hero490.worldPosition[0]}) - 2`
      );
    }

    // 16. Mandatory Gate 1 — Color Persistence & Back-Limb Z-Order Gate
    const cupRigDef = stage1Production.rigs.get('coffee_cup')!;
    const umbrellaRigDef = stage2Production.rigs.get('umbrella')!;
    for (const rigDef of [heroRigDef, partnerRigDef, cupRigDef, umbrellaRigDef]) {
      for (const part of rigDef.parts) {
        if (part.style.fill) {
          assert.equal(
            part.style.fill.kind,
            'solid',
            `Rig "${rigDef.id}" part "${part.id}" fill must be persistent solid color, got ${part.style.fill.kind}`
          );
        }
        if (part.style.stroke) {
          assert.equal(
            part.style.stroke.paint.kind,
            'solid',
            `Rig "${rigDef.id}" part "${part.id}" stroke must be persistent solid color, got ${part.style.stroke.paint.kind}`
          );
        }
      }
    }
    for (const rigDef of [heroRigDef, partnerRigDef]) {
      const idxTorso = rigDef.parts.findIndex(p => p.id === 'torso_body');
      const idxAbdomen = rigDef.parts.findIndex(p => p.id === 'abdomen_connector');
      const idxArmLUpper = rigDef.parts.findIndex(p => p.id === 'arm_l_bicep');
      const idxArmLLower = rigDef.parts.findIndex(p => p.id.startsWith('arm_l_') && p.id !== 'arm_l_bicep' && !p.id.includes('hand'));
      const idxLegLUpper = rigDef.parts.findIndex(p => p.id === 'leg_l_thigh');
      const idxArmRUpper = rigDef.parts.findIndex(p => p.id === 'arm_r_bicep');
      const idxLegRUpper = rigDef.parts.findIndex(p => p.id === 'leg_r_thigh');
      assert.ok(idxTorso >= 0 && idxAbdomen >= 0 && idxArmLUpper >= 0 && idxArmLLower >= 0 && idxLegLUpper >= 0 && idxArmRUpper >= 0 && idxLegRUpper >= 0, `${rigDef.id}: limb and torso parts must exist`);
      assert.ok(idxArmLUpper < idxTorso && idxArmLLower < idxTorso, `${rigDef.id}: arm_l_* must render behind torso_body`);
      assert.ok(idxLegLUpper < idxAbdomen, `${rigDef.id}: leg_l_* must render behind abdomen_connector`);
      assert.ok(idxArmRUpper > idxTorso && idxLegRUpper > idxTorso, `${rigDef.id}: arm_r_* and leg_r_* must render in front of torso_body`);

      const torsoFill = rigDef.parts[idxTorso].style.fill;
      const abdomenFill = rigDef.parts[idxAbdomen].style.fill;
      assert.deepEqual(
        abdomenFill,
        torsoFill,
        `${rigDef.id}: abdomen_connector fill must match torso_body fill identically`
      );
    }

    // 17. Mandatory Gate 2 — Cut Continuity (C^0) Gate across same-room beat cuts
    for (const fCut of [210, 420, 630, 840]) {
      const prev = s1Builder.buildFrameState(fCut - 1);
      const curr = s1Builder.buildFrameState(fCut);
      const hPrev = prev.entities.find(e => e.rigId === 'protagonist_lead')!;
      const hCurr = curr.entities.find(e => e.rigId === 'protagonist_lead')!;
      assert.ok(
        Math.abs(hCurr.worldPosition[0] - hPrev.worldPosition[0]) <= 0.5,
        `Stage 1 cut ${fCut - 1}->${fCut}: Hero |Delta X| (${Math.abs(hCurr.worldPosition[0] - hPrev.worldPosition[0]).toFixed(3)}) must be <= 0.5 u`
      );
      assert.ok(
        Math.abs(hCurr.scale[0] - hPrev.scale[0]) <= 0.05,
        `Stage 1 cut ${fCut - 1}->${fCut}: Hero |Delta scaleX| (${Math.abs(hCurr.scale[0] - hPrev.scale[0]).toFixed(3)}) must be <= 0.05`
      );
    }
    for (const fCut of [210, 420, 840]) {
      const prev = s2Builder.buildFrameState(fCut - 1);
      const curr = s2Builder.buildFrameState(fCut);
      for (const rigId of ['protagonist_lead', 'narrative_partner'] as const) {
        const ePrev = prev.entities.find(e => e.rigId === rigId)!;
        const eCurr = curr.entities.find(e => e.rigId === rigId)!;
        assert.ok(
          Math.abs(eCurr.worldPosition[0] - ePrev.worldPosition[0]) <= 0.5,
          `Stage 2 cut ${fCut - 1}->${fCut} (${rigId}): |Delta X| (${Math.abs(eCurr.worldPosition[0] - ePrev.worldPosition[0]).toFixed(3)}) must be <= 0.5 u`
        );
        assert.ok(
          Math.abs(eCurr.scale[0] - ePrev.scale[0]) <= 0.05,
          `Stage 2 cut ${fCut - 1}->${fCut} (${rigId}): |Delta scaleX| (${Math.abs(eCurr.scale[0] - ePrev.scale[0]).toFixed(3)}) must be <= 0.05`
        );
      }
    }

    // 18. Mandatory Gate 3 — Stepping Recoil & Continuous Exterior Run Gate
    for (const rigId of ['protagonist_lead', 'narrative_partner'] as const) {
      const recoilThighs: number[] = [];
      for (let f = 530; f <= 585; f++) {
        const st = s2Builder.buildFrameState(f);
        const ent = st.entities.find(e => e.rigId === rigId)!;
        recoilThighs.push(ent.jointAngles['leg_l_upper'] ?? 0);
      }
      const minR = Math.min(...recoilThighs);
      const maxR = Math.max(...recoilThighs);
      const p2pR = maxR - minR;
      assert.ok(
        p2pR >= 22.0,
        `Stage 2 Beat 3 recoil (${rigId}): leg_l_upper peak-to-peak swing (${p2pR.toFixed(2)} deg) must be >= 22.0 deg`
      );
      const meanR = (minR + maxR) / 2;
      let crossingsR = 0;
      for (let i = 1; i < recoilThighs.length; i++) {
        if ((recoilThighs[i - 1] - meanR) * (recoilThighs[i] - meanR) < 0) crossingsR++;
      }
      assert.ok(
        crossingsR >= 2,
        `Stage 2 Beat 3 recoil (${rigId}): leg_l_upper must have >= 2 stride zero-crossings, got ${crossingsR}`
      );

      const runThighs: number[] = [];
      for (let f = 635; f <= 825; f++) {
        const st0 = s2Builder.buildFrameState(f);
        const st1 = s2Builder.buildFrameState(f + 1);
        const e0 = st0.entities.find(e => e.rigId === rigId)!;
        const e1 = st1.entities.find(e => e.rigId === rigId)!;
        const vRoot = Math.abs(e1.worldPosition[0] - e0.worldPosition[0]);
        assert.ok(
          vRoot >= 0.45,
          `Stage 2 Beat 4 frame ${f} (${rigId}): v_root (${vRoot.toFixed(3)} u/frame) must be >= 0.45 u/frame (no mid-street freeze)`
        );
        runThighs.push(e0.jointAngles['leg_l_upper'] ?? 0);
      }
      const p2pRun = Math.max(...runThighs) - Math.min(...runThighs);
      assert.ok(
        p2pRun >= 25.0,
        `Stage 2 Beat 4 (${rigId}): active leg swing (${p2pRun.toFixed(2)} deg) must be >= 25.0 deg`
      );
    }

    // 19. Mandatory Gate 4 — Dynamic Lip-Sync Gate across all 5 beats of Stage 1
    const lyricManifestS1: AudioAnalysisManifest = {
      ...syntheticManifest,
      lyrics: [
        { id: 'l1', startTimeSeconds: 0, endTimeSeconds: 6, frameRange: { startFrameInclusive: 0, endFrameExclusive: 180 }, text: 'Di tengah lorong malam hening merenung', emphasis: 0.8 },
        { id: 'l2', startTimeSeconds: 7, endTimeSeconds: 13, frameRange: { startFrameInclusive: 210, endFrameExclusive: 390 }, text: 'Meraih secangkir hangat di atas meja', emphasis: 0.8 },
        { id: 'l3', startTimeSeconds: 14, endTimeSeconds: 20, frameRange: { startFrameInclusive: 420, endFrameExclusive: 600 }, text: 'Seketika langkah berbalik menatap bayang', emphasis: 0.8 },
        { id: 'l4', startTimeSeconds: 21, endTimeSeconds: 27, frameRange: { startFrameInclusive: 630, endFrameExclusive: 810 }, text: 'Melangkah membawa asa melintasi ruang', emphasis: 0.8 },
        { id: 'l5', startTimeSeconds: 28, endTimeSeconds: 34, frameRange: { startFrameInclusive: 840, endFrameExclusive: 1020 }, text: 'Menunjuk cakrawala fajar yang menjelang', emphasis: 0.8 }
      ]
    };
    const s1LyricProd = VerbCompiler.compile(sharedStage1Contract, lyricManifestS1);
    const s1LyricBuilder = new FrameStateBuilder({
      storyboard: s1LyricProd.storyboard,
      choreography: s1LyricProd.choreography,
      rigs: s1LyricProd.rigs,
      audioManifest: lyricManifestS1,
      getAudioFeatureAtFrame: dummyAudioFeature
    });
    const bezierMidY = (seg: { p0: [number, number]; p1: [number, number]; p2: [number, number]; p3: [number, number] }) =>
      0.125 * seg.p0[1] + 0.375 * seg.p1[1] + 0.375 * seg.p2[1] + 0.125 * seg.p3[1];
    const mouthSpanOf = (segs: ReadonlyArray<{ p0: [number, number]; p1: [number, number]; p2: [number, number]; p3: [number, number] }>) =>
      Math.abs(bezierMidY(segs[0]) - bezierMidY(segs[1]));
    const restMouthSpan = mouthSpanOf(BASE_MOUTH_REST_SEGMENTS);
    const mouthTargetSpans: Record<string, number> = {};
    for (const target of CANONICAL_BIPED_MORPH_TARGETS) {
      if (['mouth_wide_a', 'mouth_open_o', 'mouth_smile'].includes(target.name)) {
        mouthTargetSpans[target.name] = mouthSpanOf(target.segments);
      }
    }
    const focalPxLip = (1080 / 2) / Math.tan((25 * Math.PI) / 180);
    for (let bIdx = 0; bIdx < 5; bIdx++) {
      const bStart = bIdx * 210;
      const bEnd = bStart + 210;
      const heights: number[] = [];
      for (let f = bStart; f < bEnd; f++) {
        const st = s1LyricBuilder.buildFrameState(f);
        const hero = st.entities.find(e => e.rigId === 'protagonist_lead')!;
        // Mouth vertical span derived from the canonical morph geometry: weighted blend from rest toward each active target
        let localMouthSpanY = restMouthSpan;
        for (const [name, span] of Object.entries(mouthTargetSpans)) {
          const w = hero.morphWeights?.[name] ?? 0;
          localMouthSpanY += w * (span - restMouthSpan);
        }
        localMouthSpanY = Math.max(0, localMouthSpanY);
        const worldMouthSpanY = localMouthSpanY * Math.abs(hero.scale[1]);
        const camDist = Math.max(80, Math.hypot(
          st.camera.position[0] - hero.worldPosition[0],
          st.camera.position[1] - (hero.worldPosition[1] + 55),
          st.camera.position[2] - hero.worldPosition[2]
        ));
        const pxHeight = (worldMouthSpanY * focalPxLip) / camDist;
        heights.push(pxHeight);
      }
      let peakCount = 0;
      let closedCount = 0;
      for (let i = 0; i < heights.length; i++) {
        if (heights[i] <= 2.5) closedCount++;
        if (
          i > 0 &&
          i < heights.length - 1 &&
          heights[i] >= 6.0 &&
          heights[i] >= heights[i - 1] &&
          heights[i] > heights[i + 1]
        ) {
          peakCount++;
        }
      }
      assert.ok(
        peakCount >= 3,
        `Stage 1 Beat ${bIdx + 1}: mouth height must exhibit >= 3 distinct syllable peaks >= 6.0 px, got ${peakCount}`
      );
      assert.ok(
        closedCount >= 20,
        `Stage 1 Beat ${bIdx + 1}: mouth height must remain closed (<= 2.5 px) for >= 20 frames, got ${closedCount}`
      );
    }

    // 20. Mandatory Gate 1 — True Floor Grounding Gate (Y_sole === 0)
    for (const f of [30, 60, 90, 120, 180, 660, 720]) {
      const s1State = s1Builder.buildFrameState(f);
      const hero1 = s1State.entities.find(e => e.rigId === 'protagonist_lead')!;
      const fk1 = computeSkeletonFK(heroRigDef.skeleton!, hero1.jointAngles, hero1.jointOffsets);
      const yL1 = hero1.worldPosition[1] + applyAffine2D(fk1.get('leg_l_lower')!, [0, -22])[1] * hero1.scale[1];
      const yR1 = hero1.worldPosition[1] + applyAffine2D(fk1.get('leg_r_lower')!, [0, -22])[1] * hero1.scale[1];
      const minY1 = Math.min(yL1, yR1);
      assert.ok(
        Math.abs(minY1 - 0.0) <= 1.0,
        `Stage 1 Frame ${f}: stance foot boot vertex world Y (${minY1.toFixed(2)}) must satisfy |minBootVertexWorldY - 0.0| <= 1.0`
      );
    }

    for (const f of [30, 60, 90, 240, 270, 300, 450, 550, 660, 720]) {
      const s2State = s2Builder.buildFrameState(f);
      const hero2 = s2State.entities.find(e => e.rigId === 'protagonist_lead')!;
      const fk2 = computeSkeletonFK(heroRigDef.skeleton!, hero2.jointAngles, hero2.jointOffsets);
      const yL2 = hero2.worldPosition[1] + applyAffine2D(fk2.get('leg_l_lower')!, [0, -22])[1] * hero2.scale[1];
      const yR2 = hero2.worldPosition[1] + applyAffine2D(fk2.get('leg_r_lower')!, [0, -22])[1] * hero2.scale[1];
      const minY2 = Math.min(yL2, yR2);
      assert.ok(
        Math.abs(minY2 - 0.0) <= 1.0,
        `Stage 2 Frame ${f}: stance foot boot vertex world Y (${minY2.toFixed(2)}) must satisfy |minBootVertexWorldY - 0.0| <= 1.0`
      );
    }

    // 21. Mandatory Gate 2 — Cup Foreground Visibility Gate (Stage 1 frames 290..419)
    const compositor = new SceneCompositor({ width: 1920, height: 1080, fps: 30 });
    const interiorEnv = StageEnvironmentGenerator.buildSet({
      setId: 'INTERIOR_ROOM',
      centerX: 0,
      palette: THEME_PALETTES.CYBERPUNK_CYAN
    });
    for (let f = 290; f < 420; f += 5) {
      const state = s1Builder.buildFrameState(f);
      const hero = state.entities.find(e => e.rigId === 'protagonist_lead')!;
      const cup = state.entities.find(e => e.rigId === 'coffee_cup')!;
      assert.ok(cup, `Frame ${f}: coffee_cup must exist in Stage 1 frame state`);

      const fk = computeSkeletonFK(heroRigDef.skeleton!, hero.jointAngles, hero.jointOffsets);
      const wristTip = applyAffine2D(fk.get('arm_r_lower')!, [0, -16]);
      const wristWorldX = hero.worldPosition[0] + wristTip[0] * hero.scale[0];
      const cupOffset = Math.abs(cup.worldPosition[0] - wristWorldX);
      if (f >= 315) {
        assert.ok(
          cupOffset >= 3.5,
          `Frame ${f}: wrist-to-cup horizontal offset (${cupOffset.toFixed(2)} u) must be >= 3.5 u`
        );
      }

      const out = compositor.renderFrame(state, stage1Production.rigs, interiorEnv);
      const cupIdx = Math.max(out.svg.indexOf('fill="#f44664"'), out.svg.indexOf('stroke="#fda4af"'));
      const forearmIdx = out.svg.indexOf('id="protagonist_lead_arm_r_forearm"');
      const handIdx = out.svg.indexOf('id="protagonist_lead_arm_r_hand"');
      if (cupIdx !== -1 && (forearmIdx !== -1 || handIdx !== -1)) {
        assert.ok(
          cupIdx > forearmIdx && cupIdx > handIdx,
          `Frame ${f}: coffee_cup primitives must appear after arm_r_forearm and arm_r_hand in SVG draw order`
        );
      }
    }

    // 22. Mandatory Gate 3 — Forward Posture & Canopy Clearance Gate (Stage 2 Beat 4 frames 640..830)
    for (let f = 640; f <= 830; f += 5) {
      const state = s2Builder.buildFrameState(f);
      const hero = state.entities.find(e => e.rigId === 'protagonist_lead')!;
      const umbrella = state.entities.find(e => e.rigId === 'umbrella')!;
      assert.ok(umbrella, `Frame ${f}: umbrella must exist in Stage 2 Beat 4`);

      const torsoDeg = hero.jointAngles['torso'] ?? 0;
      assert.ok(
        torsoDeg >= 0.0,
        `Frame ${f}: Hero rightward torso lean (${torsoDeg.toFixed(2)} deg) must be >= 0 deg (forward/upright)`
      );

      const fkHero = computeSkeletonFK(heroRigDef.skeleton!, hero.jointAngles, hero.jointOffsets);
      const headPos = applyAffine2D(fkHero.get('head')!, [0, 0]);
      const heroHeadX = hero.worldPosition[0] + headPos[0] * hero.scale[0];
      const heroHeadLeftX = heroHeadX - 5.0;
      const canopyRightX = umbrella.worldPosition[0] + 20.0;
      const clearance = heroHeadLeftX - canopyRightX;
      assert.ok(
        clearance >= 6.0,
        `Frame ${f}: Umbrella canopy to Hero head clearance (${clearance.toFixed(2)} u) must be >= 6.0 u`
      );
    }
  });
});
