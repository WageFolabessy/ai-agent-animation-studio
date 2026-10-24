import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArchetypeFactory } from '../src/engine/library/archetype-factory.js';
import {
  MIN_PRIMARY_LUMINANCE_DELTA,
  correctPrimaryAgainst,
  enforceCastPaletteContrast,
  primariesAreDistinct,
  relativeLuminance
} from '../src/engine/library/palette-contrast.js';
import type { CastSpecItem } from '../src/schemas/story-spec.contract.js';
import { RigPartSchema } from '../src/schemas/rig.contract.js';

function makeCast(
  instanceId: string,
  paletteOverrides?: { primary?: string; accent?: string }
): CastSpecItem {
  return {
    instanceId,
    archetypeId: 'biped_three_quarters',
    role: 'PROTAGONIST',
    viewAngle: 'three_quarter',
    scale: 1.0,
    accessories: ['microphone'],
    ...(paletteOverrides ? { paletteOverrides } : {})
  };
}

describe('Character palette overrides and contrast rule', () => {
  it('resolves different solid colors on corresponding parts for two cast members', () => {
    const leadRig = ArchetypeFactory.build({
      instanceId: 'cast_a',
      spec: makeCast('cast_a', { primary: '#ff7700', accent: '#ffe600' })
    });
    const partnerRig = ArchetypeFactory.build({
      instanceId: 'cast_b',
      spec: makeCast('cast_b', { primary: '#2244cc', accent: '#00e5ff' })
    });

    assert.equal(leadRig.parts.length, partnerRig.parts.length);
    let differing = 0;
    let overriddenParts = 0;
    for (let i = 0; i < leadRig.parts.length; i++) {
      const a = leadRig.parts[i];
      const b = partnerRig.parts[i];
      assert.equal(a.id, b.id);
      for (const [pa, pb] of [
        [a.style.fill, b.style.fill],
        [a.style.stroke?.paint, b.style.stroke?.paint]
      ] as const) {
        if (pa?.kind === 'solid' && pb?.kind === 'solid') {
          overriddenParts++;
          if (pa.color !== pb.color) differing++;
        }
      }
    }
    assert.ok(overriddenParts > 0, 'overrides must produce solid paints');
    assert.ok(differing > 0, 'corresponding parts must resolve to different colors');
    assert.equal(differing, overriddenParts, 'every overridden pair must differ');

    const baseRig = ArchetypeFactory.build({ instanceId: 'cast_a', spec: makeCast('cast_a') });
    for (let i = 0; i < leadRig.parts.length; i++) {
      const part = leadRig.parts[i];
      RigPartSchema.parse(part);
      assert.equal(
        part.style.lit,
        baseRig.parts[i].style.lit,
        `${part.id} keeps its lighting flag so shot lighting still modulates lit parts`
      );
    }
  });

  it('leaves no primary or accent palette role on any part when both overrides are given', () => {
    const rig = ArchetypeFactory.build({
      instanceId: 'cast_c',
      spec: makeCast('cast_c', { primary: '#123456', accent: '#abcdef' })
    });
    for (const part of rig.parts) {
      for (const paint of [part.style.fill, part.style.stroke?.paint]) {
        if (paint?.kind === 'palette') {
          assert.ok(
            paint.role !== 'primary' && paint.role !== 'accent',
            `${part.id} still references palette role ${paint.role}`
          );
        }
      }
    }
  });

  it('still builds and keeps palette paints for a spec without overrides', () => {
    const rig = ArchetypeFactory.build({ instanceId: 'cast_d', spec: makeCast('cast_d') });
    assert.ok(rig.parts.length > 0);
    assert.ok(
      rig.parts.some((p) => p.style.fill?.kind === 'palette'),
      'palette paints remain when no override is declared'
    );
    const quad = ArchetypeFactory.build({
      instanceId: 'cast_e',
      spec: { ...makeCast('cast_e'), archetypeId: 'quadruped_beast' }
    });
    assert.ok(quad.parts.length > 0);
  });

  it('applies overrides to non-biped archetypes too', () => {
    const quad = ArchetypeFactory.build({
      instanceId: 'cast_f',
      spec: {
        ...makeCast('cast_f', { primary: '#ff0000', accent: '#00ff00' }),
        archetypeId: 'quadruped_beast',
        accessories: []
      }
    });
    assert.ok(quad.parts.some((p) => p.style.fill?.kind === 'solid'));
  });

  it('corrects similar lead and partner primaries deterministically to the stated minimum', () => {
    const lead = '#1e293b';
    const partner = '#334155';
    assert.equal(primariesAreDistinct(lead, partner), false);

    const corrected = correctPrimaryAgainst(lead, partner);
    assert.equal(corrected, correctPrimaryAgainst(lead, partner), 'deterministic');
    assert.ok(
      Math.abs(relativeLuminance(lead) - relativeLuminance(corrected)) >=
        MIN_PRIMARY_LUMINANCE_DELTA,
      `corrected ${corrected} must differ in luminance by >= ${MIN_PRIMARY_LUMINANCE_DELTA}`
    );

    const cast = enforceCastPaletteContrast([
      makeCast('lead', { primary: lead, accent: '#94a3b8' }),
      makeCast('partner', { primary: partner, accent: '#38bdf8' })
    ]);
    assert.equal(cast[0].paletteOverrides?.primary, lead);
    assert.equal(cast[1].paletteOverrides?.primary, corrected);
    assert.equal(cast[1].paletteOverrides?.accent, '#38bdf8', 'accent is untouched');

    const again = enforceCastPaletteContrast(cast);
    assert.deepEqual(again, cast, 'enforcement is idempotent');
  });

  it('corrects against a bright lead by darkening and leaves compliant casts unchanged', () => {
    const lead = '#f5f5f5';
    const partner = '#eeeeee';
    const corrected = correctPrimaryAgainst(lead, partner);
    assert.ok(relativeLuminance(corrected) < relativeLuminance(partner));
    assert.ok(primariesAreDistinct(lead, corrected));

    const compliant = [
      makeCast('lead', { primary: '#00f0ff' }),
      makeCast('partner', { primary: '#212121' })
    ];
    assert.deepEqual(enforceCastPaletteContrast(compliant), compliant);
  });

  it('accepts chromatic pairs with sufficiently different hues even at similar luminance', () => {
    assert.equal(primariesAreDistinct('#ff0000', '#0000ff'), true);
    assert.equal(primariesAreDistinct('#ff0000', '#ff1111'), false);
  });

  it('does nothing when the lead has no primary override or the partner has none', () => {
    const noLead = [makeCast('lead'), makeCast('partner', { primary: '#101010' })];
    assert.deepEqual(enforceCastPaletteContrast(noLead), noLead);
    const noPartner = [makeCast('lead', { primary: '#101010' }), makeCast('partner')];
    assert.deepEqual(enforceCastPaletteContrast(noPartner), noPartner);
  });
});
