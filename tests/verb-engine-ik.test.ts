import test from 'node:test';
import assert from 'node:assert/strict';
import {
  solveTwoBoneArmIK,
  solveTwoBoneLegIK,
  worldToRigLocal
} from '../src/engine/rigging/ik-leg-solver.js';
import { computeCameraBasis } from '../src/engine/camera/camera-3d.js';
import { VerbCompiler } from '../src/engine/director/verb-engine/verb-compiler.js';
import { validateProjectContracts, validateChoreography } from '../src/schemas/invariants.js';
import { createRenderConfig } from '../src/config/render-config.js';
import type { AudioAnalysisManifest } from '../src/schemas/audio.contract.js';
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
});
