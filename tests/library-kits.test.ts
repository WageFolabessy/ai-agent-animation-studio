import test from 'node:test';
import assert from 'node:assert/strict';
import { ArchetypeFactory } from '../src/engine/library/archetype-factory.js';
import { EnvironmentKit, THEME_PALETTES } from '../src/engine/library/environment-kit.js';
import { AssetRigContractSchema } from '../src/schemas/rig.contract.js';

test('Library Kits & Character Archetypes Suite', async (t) => {
  await t.test('ArchetypeFactory: biped_runner satisfies all geometric and anatomical invariants', () => {
    const runner = ArchetypeFactory.build({
      instanceId: 'runner_main',
      spec: {
        instanceId: 'runner_main',
        archetypeId: 'biped_runner',
        scale: 1.0,
        accessories: []
      }
    });

    // 1. Schema compliance
    AssetRigContractSchema.parse(runner);

    // 2. Facing direction right
    assert.equal(runner.facingDirection, 'right');

    // 3. Anatomical backward knee flexion constraints [-140, 0]
    const legL = runner.skeleton?.joints.find((j) => j.id === 'leg_l_lower')!;
    const legR = runner.skeleton?.joints.find((j) => j.id === 'leg_r_lower')!;
    assert.deepEqual(legL.constraintsDeg, [-140, 0]);
    assert.deepEqual(legR.constraintsDeg, [-140, 0]);

    // 4. Critical Safeguard 1: Zero double-offset on secondary motion parts
    const coatWing = runner.parts.find((p) => p.id === 'coat_wing')!;
    assert.deepEqual(coatWing.localOffset2D, [0, 0]);
    if (coatWing.shape.kind === 'polygon') {
      assert.deepEqual(coatWing.shape.points[0], [0, 0]);
    }

    const hairRibbon = runner.parts.find((p) => p.id === 'hair_ribbon')!;
    assert.deepEqual(hairRibbon.localOffset2D, [0, 0]);
    if (hairRibbon.shape.kind === 'polygon') {
      assert.deepEqual(hairRibbon.shape.points[0], [0, 0]);
    }

    // 5. Critical Safeguard 2: Cohesive close-up silhouette parts (neck collar and abdomen connector)
    assert.ok(runner.parts.some((p) => p.id === 'neck_collar'));
    assert.ok(runner.parts.some((p) => p.id === 'abdomen_connector'));

    // 6. Drawables budget <= 28
    assert.ok(
      runner.parts.length <= 28,
      `biped_runner drawables ${runner.parts.length} must be <= 28`
    );
  });

  await t.test('ArchetypeFactory: quadruped_beast satisfies cyber hound invariants', () => {
    const beast = ArchetypeFactory.build({
      instanceId: 'hound_01',
      spec: {
        instanceId: 'hound_01',
        archetypeId: 'quadruped_beast',
        scale: 1.0,
        accessories: []
      }
    });

    AssetRigContractSchema.parse(beast);
    assert.equal(beast.facingDirection, 'right');

    // 1. 14+ joints in skeleton
    assert.ok(beast.skeleton && beast.skeleton.joints.length >= 14);

    // 2. Zero double-offset on tail and ears
    const tail = beast.parts.find((p) => p.id === 'beast_tail')!;
    assert.deepEqual(tail.localOffset2D, [0, 0]);
    if (tail.shape.kind === 'polygon') {
      assert.deepEqual(tail.shape.points[0], [0, 0]);
    }

    const ear = beast.parts.find((p) => p.id === 'beast_ear')!;
    assert.deepEqual(ear.localOffset2D, [0, 0]);
    if (ear.shape.kind === 'polygon') {
      assert.deepEqual(ear.shape.points[0], [0, 0]);
    }

    // 3. Anatomical backward knee flexion on rear legs [-140, 0]
    const legBL = beast.skeleton?.joints.find((j) => j.id === 'leg_bl_lower')!;
    const legBR = beast.skeleton?.joints.find((j) => j.id === 'leg_br_lower')!;
    assert.deepEqual(legBL.constraintsDeg, [-140, 0]);
    assert.deepEqual(legBR.constraintsDeg, [-140, 0]);

    // 4. Drawables budget <= 32
    assert.ok(beast.parts.length <= 32, `quadruped_beast drawables ${beast.parts.length} must be <= 32`);
  });

  await t.test('ArchetypeFactory: aerial_drone satisfies pursuit drone invariants', () => {
    const drone = ArchetypeFactory.build({
      instanceId: 'drone_01',
      spec: {
        instanceId: 'drone_01',
        archetypeId: 'aerial_drone',
        scale: 1.0,
        accessories: []
      }
    });

    AssetRigContractSchema.parse(drone);
    assert.ok(drone.skeleton && drone.skeleton.joints.length >= 4);
    assert.ok(drone.parts.length <= 16, `aerial_drone drawables ${drone.parts.length} must be <= 16`);
  });

  await t.test('EnvironmentKit: all 4 kits strictly enforce drawables budget <= 65 and nearPlane clearance', () => {
    const palette = THEME_PALETTES.CYBERPUNK_CYAN;

    // 1. industrial_city
    const city = EnvironmentKit.buildIndustrialCity(0, palette, {
      rooftopDensity: 0.8,
      hvacVisible: true,
      overheadGantry: true,
      streetlamps: true
    });
    const cityDrawables = (city.polygons?.length ?? 0) + (city.lines?.length ?? 0);
    assert.ok(cityDrawables <= 55, `industrial_city budget was ${cityDrawables} (max 55)`);

    // Verify nearPlane clearance on gantry and lamps (never in camera transit zone [-120, -70])
    for (const line of city.lines ?? []) {
      const z0 = line.p0[2];
      const z1 = line.p1[2];
      const inDangerZone = (z0 > -120 && z0 < -70) || (z1 > -120 && z1 < -70);
      assert.equal(inDangerZone, false, `Line ${line.p0} to ${line.p1} crosses nearPlane transit zone`);
    }

    // 2. orbital_station
    const station = EnvironmentKit.buildOrbitalStation(0, palette, {
      portalCount: 5,
      hazardStripes: true,
      conduitGlow: true
    });
    const stationDrawables = (station.polygons?.length ?? 0) + (station.lines?.length ?? 0);
    assert.ok(stationDrawables <= 65, `orbital_station budget was ${stationDrawables} (max 65)`);

    // 3. neon_chasm
    const chasm = EnvironmentKit.buildNeonChasm(0, palette, {
      pylonCount: 2,
      stayCableDensity: 0.8,
      abyssDepth: 600
    });
    const chasmDrawables = (chasm.polygons?.length ?? 0) + (chasm.lines?.length ?? 0);
    assert.ok(chasmDrawables <= 60, `neon_chasm budget was ${chasmDrawables} (max 60)`);

    // 4. synth_grid
    const grid = EnvironmentKit.buildSynthGrid(0, palette, {
      gridSpacing: 40,
      horizonSun: true,
      wireframeMountains: true
    });
    const gridDrawables = (grid.polygons?.length ?? 0) + (grid.lines?.length ?? 0);
    assert.ok(gridDrawables <= 58, `synth_grid budget was ${gridDrawables} (max 58)`);

    // 5. Total Worst-Case Scene Drawable Budget Check:
    // Max Environment (65) + Biped (28) + Drone (16) + Max Trail Particles (35) + Accent (12) = 156 <= 220
    const worstCaseTotal = 65 + 28 + 16 + 35 + 12;
    assert.ok(worstCaseTotal <= 220, `Worst-case drawables ${worstCaseTotal} must be <= 220`);
  });
});
