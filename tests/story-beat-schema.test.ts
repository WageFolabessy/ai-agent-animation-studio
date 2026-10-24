import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RawStoryBeatOutputSchema,
  normalizeStoryBeatVocabulary,
  StoryBeatContractSchema
} from '../src/schemas/story-beat.contract.js';

test('StoryBeat Two-Layer Schema Suite', async (t) => {
  await t.test('Layer 1 accepts arbitrary strings without throwing schema validation errors', () => {
    const openRawOutput = {
      beats: [
        {
          beatId: 'beat_01',
          lyricSnippet: 'Di tengah malam sunyi sepi',
          set: {
            kitId: 'abandoned_cyber_factory', // Outside closed enum
            variantId: 'moody_night'
          },
          actions: [
            {
              instanceId: 'char_lead',
              verb: 'swim_across_river', // Outside closed enum
              target: 'far_bank'
            }
          ]
        }
      ]
    };

    const parsed = RawStoryBeatOutputSchema.safeParse(openRawOutput);
    assert.equal(parsed.success, true, 'Layer 1 must accept open vocabulary strings');
  });

  await t.test('Layer 2 normalizes open strings to canonical enums and logs unfulfilled requests', () => {
    const rawData = {
      projectId: 'test_project',
      songDurationSec: 35,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 1050 },
      beats: [
        {
          beatId: 'beat_01',
          lyricSnippet: 'Langkah perlahan menatap bayang',
          set: {
            kitId: 'neon_chasm_bridge',
            variantId: 'moody_night'
          },
          actions: [
            {
              instanceId: 'protagonist_lead',
              verb: 'crouch_behind_pillar'
            }
          ]
        }
      ]
    };

    const normalized = normalizeStoryBeatVocabulary(rawData);

    assert.equal(normalized.beats[0].set.kitId, 'ARCHITECTURAL_INTERIOR');
    assert.equal(normalized.beats[0].actions[0].verb, 'sit_stand');
    assert.equal(normalized.unfulfilledRequests.length >= 2, true);

    const setLog = normalized.unfulfilledRequests.find((r) => r.entityType === 'set');
    assert.ok(setLog);
    assert.equal(setLog?.requestedEntity, 'neon_chasm_bridge');

    const verbLog = normalized.unfulfilledRequests.find((r) => r.entityType === 'verb');
    assert.ok(verbLog);
    assert.equal(verbLog?.requestedEntity, 'crouch_behind_pillar');

    // Strict contract schema validation
    const parsedContract = StoryBeatContractSchema.safeParse(normalized);
    assert.equal(parsedContract.success, true, 'Normalized output must strictly satisfy StoryBeatContractSchema');
  });

  await t.test('Multilingual lyrics ingestion preserves non-English characters cleanly', () => {
    const multilingualRaw = {
      projectId: 'multilingual_proj',
      songDurationSec: 35,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 900 },
      cast: [
        {
          instanceId: 'lead',
          role: 'PROTAGONIST',
          archetypeId: 'hero_silhouette',
          palette: { primary: '#0a1128', accent: '#00f0ff' }
        }
      ],
      beats: [
        {
          beatId: 'beat_indo',
          lyricSnippet: 'Biar ku raih secangkir harapan di meja ini',
          actions: [{ instanceId: 'lead', verb: 'reach_and_grasp' }]
        },
        {
          beatId: 'beat_jp',
          lyricSnippet: '夜明け前の光を探して歩き続ける',
          actions: [{ instanceId: 'lead', verb: 'walk_to' }]
        }
      ]
    };

    const contract = normalizeStoryBeatVocabulary(multilingualRaw);

    assert.equal(contract.beats[0].lyricSnippet, 'Biar ku raih secangkir harapan di meja ini');
    assert.equal(contract.beats[1].lyricSnippet, '夜明け前の光を探して歩き続ける');
    assert.equal(contract.beats.length, 2);
  });
});
