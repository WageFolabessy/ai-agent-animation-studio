import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArchetypeFactory } from '../src/engine/library/archetype-factory.js';
import {
  OUTLINE_MIN_WIDTH,
  OUTLINE_MAX_WIDTH,
  OUTLINE_MIN_RIM_SHADE
} from '../src/engine/library/outline-policy.js';
import { AssetRigContractSchema } from '../src/schemas/rig.contract.js';
import { NarrativePropIdSchema } from '../src/schemas/prop.contract.js';
import { analyzeClipContactStride } from '../src/engine/director/trajectory-solver.js';
import { BipedPoseClips, QuadrupedPoseClips } from '../src/engine/library/archetype-factory.js';

describe('Silhouette & Outline Policy with Anatomical Feet (F3 Regression)', () => {
  const archetypes = [
    'biped_runner',
    'biped_frontal',
    'biped_three_quarters',
    'quadruped_beast',
    'aerial_drone'
  ] as const;

  it('every body part of every archetype has a defined stroke within outline policy bounds', () => {
    for (const arch of archetypes) {
      const rig = ArchetypeFactory.build({
        instanceId: `test_${arch}`,
        spec: {
          instanceId: `test_${arch}`,
          archetypeId: arch,
          viewAngle: arch === 'biped_frontal' ? 'front' : 'three_quarter',
          scale: 1.0,
          accessories: []
        }
      });

      AssetRigContractSchema.parse(rig);

      for (const part of rig.parts) {
        assert.ok(
          part.style.stroke !== undefined,
          `Archetype ${arch} part ${part.id} must declare a stroke`
        );
        const strokeWidth = part.style.stroke.width;
        assert.ok(
          strokeWidth >= OUTLINE_MIN_WIDTH - 1e-4 && strokeWidth <= OUTLINE_MAX_WIDTH + 1e-4,
          `Archetype ${arch} part ${part.id} stroke width ${strokeWidth} must be in [${OUTLINE_MIN_WIDTH}, ${OUTLINE_MAX_WIDTH}]`
        );

        // Verify stroke paint role and contrast
        const strokePaint = part.style.stroke.paint;
        assert.ok(
          strokePaint.kind === 'palette' || strokePaint.kind === 'solid',
          `Archetype ${arch} part ${part.id} stroke paint must be valid`
        );
        if (strokePaint.kind === 'palette') {
          assert.ok(
            strokePaint.shade >= OUTLINE_MIN_RIM_SHADE - 1e-4,
            `Archetype ${arch} part ${part.id} stroke shade ${strokePaint.shade} must be >= ${OUTLINE_MIN_RIM_SHADE}`
          );
        }

        // Body limbs that previously had no stroke (shin, thighs, biceps, forearms) now have matching family rim
        const unstrokedLimbs = ['leg_l_shin', 'leg_l_thigh', 'arm_l_bicep', 'arm_l_forearm', 'beast_fl_shin', 'beast_chassis'];
        if (unstrokedLimbs.includes(part.id) && strokePaint.kind === 'palette' && part.style.fill?.kind === 'palette') {
          assert.equal(
            strokePaint.role,
            part.style.fill.role === 'background' ? 'secondary' : part.style.fill.role,
            `Archetype ${arch} limb ${part.id} stroke role must derive from fill role`
          );
        }
      }
    }
  });

  it('every locomotion rig has foot or boot parts bound to its lower leg joint chain', () => {
    // 1. Biped rigs: both left and right feet must be bound to leg_l_lower and leg_r_lower
    for (const bipedArch of ['biped_runner', 'biped_frontal', 'biped_three_quarters'] as const) {
      const rig = ArchetypeFactory.build({
        instanceId: `biped_${bipedArch}`,
        spec: {
          instanceId: `biped_${bipedArch}`,
          archetypeId: bipedArch,
          viewAngle: bipedArch === 'biped_frontal' ? 'front' : 'three_quarter',
          scale: 1.0,
          accessories: []
        }
      });

      const leftFoot = rig.parts.find((p) => p.id === 'leg_l_foot');
      const rightFoot = rig.parts.find((p) => p.id === 'leg_r_foot');

      assert.ok(leftFoot, `${bipedArch} must have leg_l_foot`);
      assert.ok(rightFoot, `${bipedArch} must have leg_r_foot`);
      assert.equal(leftFoot.jointId, 'leg_l_lower');
      assert.equal(rightFoot.jointId, 'leg_r_lower');
      assert.deepEqual(leftFoot.localOffset2D, [0, -22]);
      assert.deepEqual(rightFoot.localOffset2D, [0, -22]);
    }

    // 2. Quadruped rig: all 4 cyber paws bound to lower legs
    const beast = ArchetypeFactory.build({
      instanceId: 'beast_01',
      spec: {
        instanceId: 'beast_01',
        archetypeId: 'quadruped_beast',
        scale: 1.0,
        accessories: []
      }
    });

    const expectedPaws = [
      { id: 'beast_fl_paw', jointId: 'leg_fl_lower', offset: [0, -18] },
      { id: 'beast_fr_paw', jointId: 'leg_fr_lower', offset: [0, -18] },
      { id: 'beast_bl_paw', jointId: 'leg_bl_lower', offset: [0, -20] },
      { id: 'beast_br_paw', jointId: 'leg_br_lower', offset: [0, -20] }
    ];

    for (const ep of expectedPaws) {
      const part = beast.parts.find((p) => p.id === ep.id);
      assert.ok(part, `quadruped_beast must have ${ep.id}`);
      assert.equal(part.jointId, ep.jointId);
      assert.deepEqual(part.localOffset2D, ep.offset);
    }
  });

  it('preserves foot-contact invariants across locomotion clips with boots/paws in place', () => {
    const runner = ArchetypeFactory.build({
      instanceId: 'runner_main',
      spec: {
        instanceId: 'runner_main',
        archetypeId: 'biped_runner',
        scale: 1.0,
        accessories: []
      }
    });

    const runnerAnalysis = analyzeClipContactStride(
      runner,
      BipedPoseClips.sprint_frenzy,
      'sprint_frenzy'
    );
    assert.ok(
      runnerAnalysis.maxRelativeDeviation <= 0.02,
      `sprint_frenzy foot slip must be <= 2%, got ${runnerAnalysis.maxRelativeDeviation}`
    );
    assert.ok(runnerAnalysis.contactFrameCount > 0);

    const beast = ArchetypeFactory.build({
      instanceId: 'beast_main',
      spec: {
        instanceId: 'beast_main',
        archetypeId: 'quadruped_beast',
        scale: 1.0,
        accessories: []
      }
    });

    const beastAnalysis = analyzeClipContactStride(
      beast,
      QuadrupedPoseClips.beast_gallop,
      'beast_gallop'
    );
    assert.ok(
      beastAnalysis.maxRelativeDeviation <= 0.02,
      `beast_gallop paw slip must be <= 2%, got ${beastAnalysis.maxRelativeDeviation}`
    );
    assert.ok(beastAnalysis.contactFrameCount >= 10);
  });

  it('all archetype and prop combinations strictly obey rig parts count <= 28', () => {
    for (const arch of archetypes) {
      for (const prop of NarrativePropIdSchema.options) {
        const rig = ArchetypeFactory.build({
          instanceId: `prop_test_${arch}_${prop}`,
          spec: {
            instanceId: `prop_test_${arch}_${prop}`,
            archetypeId: arch,
            viewAngle: arch === 'biped_frontal' ? 'front' : 'three_quarter',
            scale: 1.0,
            accessories: [prop]
          }
        });
        assert.ok(
          rig.parts.length <= 28,
          `Rig ${arch} with prop ${prop} has ${rig.parts.length} parts (must be <= 28)`
        );
      }
    }
  });
});
