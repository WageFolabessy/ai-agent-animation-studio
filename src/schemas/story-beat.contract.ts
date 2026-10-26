import { z } from 'zod';
import { RigSocketSlotSchema } from './prop.contract.js';

export const ActionVerbTypeSchema = z.enum([
  'walk_to',
  'run_to',
  'stop_and_turn',
  'look_at',
  'reach_and_grasp',
  'carry_put_down',
  'sit_stand',
  'gesture_point',
  'embrace_push_away',
  'fall_recover'
]);
export type ActionVerbType = z.infer<typeof ActionVerbTypeSchema>;

export const VerbTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('character'), targetId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('prop'), propId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('position'), pos: z.tuple([z.number(), z.number(), z.number()]) }).strict(),
  z.object({ kind: z.literal('direction'), facingDeg: z.number().finite() }).strict()
]);
export type VerbTarget = z.infer<typeof VerbTargetSchema>;

export const CharacterActionDirectiveSchema = z.object({
  instanceId: z.string().min(1),
  verb: ActionVerbTypeSchema,
  target: VerbTargetSchema.optional(),
  speedNorm: z.number().finite().min(0.2).max(2.5).default(1.0),
  intensityNorm: z.number().finite().min(0.0).max(1.0).default(0.7),
  gazeTarget: VerbTargetSchema.optional(),
  propSocket: RigSocketSlotSchema.optional(),
  associatedPropId: z.string().optional()
}).strict();
export type CharacterActionDirective = z.infer<typeof CharacterActionDirectiveSchema>;

export const CameraIntentSchema = z.object({
  framing: z.enum(['EXTREME_WIDE', 'WIDE', 'MEDIUM', 'CLOSE_UP', 'INSERT']),
  movement: z.enum(['STATIC', 'PAN', 'DOLLY', 'TILT', 'ARC']),
  focalCharacterId: z.string().min(1).default('protagonist_lead'),
  lookRoom: z.enum(['left', 'right', 'center']).default('center'),
  dutchAngleDeg: z.number().finite().min(-15).max(15).default(0)
}).strict();
export type CameraIntent = z.infer<typeof CameraIntentSchema>;

export const ParametricSetSelectionSchema = z.object({
  kitId: z.enum(['ARCHITECTURAL_INTERIOR', 'EXTERIOR_URBAN_VISTA']),
  variantId: z.enum(['moody_night', 'dramatic_twilight', 'storm_overcast', 'clean_minimal']),
  landmarkProps: z.array(z.string()).max(4).default([]),
  landmarkPlacements: z.record(z.string(), z.tuple([z.number(), z.number(), z.number()])).optional(),
  atmosphericDensity: z.number().finite().min(0).max(1).default(0.5)
}).strict();
export type ParametricSetSelection = z.infer<typeof ParametricSetSelectionSchema>;

export const StoryBeatSchema = z.object({
  beatId: z.string().min(1),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().positive(),
  lyricSnippet: z.string().default(''),
  emotionalTone: z.enum(['defiant', 'melancholic', 'tender', 'euphoric', 'menacing', 'reflective', 'chaotic']),
  narrativeSubtext: z.string().min(1),
  presentCharacters: z.array(z.string()).min(1),
  set: ParametricSetSelectionSchema,
  actions: z.array(CharacterActionDirectiveSchema).min(1),
  camera: CameraIntentSchema,
  transition: z.enum(['cut', 'dissolve', 'dip_to_black']).optional(),
  transitionDurationFrames: z.number().int().min(0).max(60).optional()
}).strict().refine(b => b.endFrame > b.startFrame, {
  message: 'endFrame must be strictly greater than startFrame'
});
export type StoryBeat = z.infer<typeof StoryBeatSchema>;

export const UnfulfilledRequestLogSchema = z.object({
  beatId: z.string(),
  requestedEntity: z.string(),
  entityType: z.enum(['verb', 'set', 'prop', 'camera']),
  reason: z.string(),
  fallbackApplied: z.string()
}).strict();
export type UnfulfilledRequestLog = z.infer<typeof UnfulfilledRequestLogSchema>;

export const StoryBeatContractSchema = z.object({
  projectId: z.string().min(1),
  songDurationSec: z.number().positive(),
  fps: z.number().int().positive().default(30),
  sliceFrameRange: z.object({
    startFrame: z.number().int().min(0),
    endFrame: z.number().int().positive()
  }).strict(),
  cast: z.array(z.object({
    instanceId: z.string(),
    role: z.enum(['PROTAGONIST', 'PARTNER', 'ANTAGONIST']),
    archetypeId: z.enum(['hero_silhouette', 'companion_silhouette']),
    palette: z.object({
      primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/)
    }).strict()
  })).min(1),
  beats: z.array(StoryBeatSchema).min(1),
  unfulfilledRequests: z.array(UnfulfilledRequestLogSchema).default([])
}).strict();
export type StoryBeatContract = z.infer<typeof StoryBeatContractSchema>;

// ============================================================================
// Layer 1: Raw Output Schema for LLM Response (Permissive open strings)
// ============================================================================

export const RawVerbTargetSchema = z.union([
  z.object({ kind: z.literal('character'), targetId: z.string() }),
  z.object({ kind: z.literal('prop'), propId: z.string() }),
  z.object({ kind: z.literal('position'), pos: z.tuple([z.number(), z.number(), z.number()]) }),
  z.object({ kind: z.literal('direction'), facingDeg: z.number() }),
  z.string()
]);

export const RawCharacterActionDirectiveSchema = z.object({
  instanceId: z.string().min(1),
  verb: z.string().min(1),
  target: RawVerbTargetSchema.optional(),
  speedNorm: z.number().optional(),
  intensityNorm: z.number().optional(),
  gazeTarget: RawVerbTargetSchema.optional(),
  propSocket: z.string().optional(),
  associatedPropId: z.string().optional()
});

export const RawCameraIntentSchema = z.object({
  framing: z.string().optional(),
  movement: z.string().optional(),
  focalCharacterId: z.string().optional(),
  lookRoom: z.string().optional(),
  dutchAngleDeg: z.number().optional()
});

export const RawParametricSetSelectionSchema = z.object({
  kitId: z.string().optional(),
  variantId: z.string().optional(),
  landmarkProps: z.array(z.string()).optional(),
  landmarkPlacements: z.record(z.string(), z.tuple([z.number(), z.number(), z.number()])).optional(),
  atmosphericDensity: z.number().optional()
});

export const RawStoryBeatSchema = z.object({
  beatId: z.string().optional(),
  startFrame: z.number().int().optional(),
  endFrame: z.number().int().optional(),
  lyricSnippet: z.string().optional(),
  emotionalTone: z.string().optional(),
  narrativeSubtext: z.string().optional(),
  presentCharacters: z.array(z.string()).optional(),
  set: RawParametricSetSelectionSchema.optional(),
  actions: z.array(RawCharacterActionDirectiveSchema).optional(),
  camera: RawCameraIntentSchema.optional(),
  transition: z.string().optional(),
  transitionDurationFrames: z.number().int().optional()
});

export const RawStoryBeatOutputSchema = z.object({
  projectId: z.string().optional(),
  songDurationSec: z.number().optional(),
  fps: z.number().optional(),
  sliceFrameRange: z.object({
    startFrame: z.number().int().optional(),
    endFrame: z.number().int().optional()
  }).optional(),
  cast: z.array(z.object({
    instanceId: z.string(),
    role: z.string().optional(),
    archetypeId: z.string().optional(),
    palette: z.object({
      primary: z.string().optional(),
      accent: z.string().optional()
    }).optional()
  })).optional(),
  beats: z.array(RawStoryBeatSchema).optional(),
  unfulfilledRequests: z.array(UnfulfilledRequestLogSchema).optional()
});
export type RawStoryBeatOutput = z.infer<typeof RawStoryBeatOutputSchema>;

// ============================================================================
// Layer 2: Deterministic Normalizer & Vocabulary Mapper
// ============================================================================

const CANONICAL_VERBS: ActionVerbType[] = [
  'walk_to',
  'run_to',
  'stop_and_turn',
  'look_at',
  'reach_and_grasp',
  'carry_put_down',
  'sit_stand',
  'gesture_point',
  'embrace_push_away',
  'fall_recover'
];

const VERB_FALLBACK_MAP: Record<string, ActionVerbType> = {
  swim: 'walk_to',
  fly: 'run_to',
  kneel_and_pray: 'sit_stand',
  kneel: 'sit_stand',
  crouch: 'sit_stand',
  stand: 'sit_stand',
  sit: 'sit_stand',
  jump: 'run_to',
  leap: 'run_to',
  sing: 'gesture_point',
  shout: 'gesture_point',
  scream: 'gesture_point',
  point: 'gesture_point',
  reach: 'reach_and_grasp',
  grab: 'reach_and_grasp',
  take: 'reach_and_grasp',
  hold: 'reach_and_grasp',
  drop: 'carry_put_down',
  place: 'carry_put_down',
  turn: 'stop_and_turn',
  stop: 'stop_and_turn',
  hug: 'embrace_push_away',
  embrace: 'embrace_push_away',
  push: 'embrace_push_away',
  give_and_receive: 'embrace_push_away',
  handoff: 'embrace_push_away',
  confront_step_in: 'embrace_push_away',
  confront: 'embrace_push_away',
  parallel_stride: 'walk_to',
  walk_together: 'walk_to',
  fall: 'fall_recover',
  collapse: 'fall_recover',
  stumble: 'fall_recover'
};

const CANONICAL_SETS: Array<'ARCHITECTURAL_INTERIOR' | 'EXTERIOR_URBAN_VISTA'> = [
  'ARCHITECTURAL_INTERIOR',
  'EXTERIOR_URBAN_VISTA'
];

const SET_FALLBACK_MAP: Record<string, 'ARCHITECTURAL_INTERIOR' | 'EXTERIOR_URBAN_VISTA'> = {
  room: 'ARCHITECTURAL_INTERIOR',
  indoor: 'ARCHITECTURAL_INTERIOR',
  interior: 'ARCHITECTURAL_INTERIOR',
  office: 'ARCHITECTURAL_INTERIOR',
  church: 'ARCHITECTURAL_INTERIOR',
  cathedral: 'ARCHITECTURAL_INTERIOR',
  street: 'EXTERIOR_URBAN_VISTA',
  outdoor: 'EXTERIOR_URBAN_VISTA',
  city: 'EXTERIOR_URBAN_VISTA',
  urban: 'EXTERIOR_URBAN_VISTA',
  rooftop: 'EXTERIOR_URBAN_VISTA'
};

const CANONICAL_TONES = [
  'defiant',
  'melancholic',
  'tender',
  'euphoric',
  'menacing',
  'reflective',
  'chaotic'
] as const;

export function normalizeStoryBeatVocabulary(raw: unknown): StoryBeatContract {
  const parsed = RawStoryBeatOutputSchema.parse(raw);
  const unfulfilled: UnfulfilledRequestLog[] = [...(parsed.unfulfilledRequests ?? [])];

  const projectId = parsed.projectId ?? 'vertical-slice';
  const songDurationSec = parsed.songDurationSec ?? 35;
  const fps = parsed.fps ?? 30;
  const sliceFrameRange = {
    startFrame: parsed.sliceFrameRange?.startFrame ?? 0,
    endFrame: parsed.sliceFrameRange?.endFrame ?? Math.round(songDurationSec * fps)
  };

  const cast = (parsed.cast && parsed.cast.length > 0)
    ? parsed.cast.map((c, idx) => {
        const role: 'PROTAGONIST' | 'PARTNER' | 'ANTAGONIST' = (c.role === 'PARTNER' || c.role === 'ANTAGONIST') ? c.role : 'PROTAGONIST';
        const archetypeId = (c.archetypeId === 'companion_silhouette' || role !== 'PROTAGONIST')
          ? 'companion_silhouette'
          : 'hero_silhouette';
        const primary = (c.palette?.primary && /^#[0-9a-fA-F]{6}$/.test(c.palette.primary))
          ? c.palette.primary
          : (archetypeId === 'hero_silhouette' ? '#0a1128' : '#ff9100');
        const accent = (c.palette?.accent && /^#[0-9a-fA-F]{6}$/.test(c.palette.accent))
          ? c.palette.accent
          : (archetypeId === 'hero_silhouette' ? '#00f0ff' : '#d4af37');
        return {
          instanceId: c.instanceId ?? (idx === 0 ? 'protagonist_lead' : 'companion_partner'),
          role,
          archetypeId: archetypeId as 'hero_silhouette' | 'companion_silhouette',
          palette: { primary, accent }
        };
      })
    : [
        {
          instanceId: 'protagonist_lead',
          role: 'PROTAGONIST' as const,
          archetypeId: 'hero_silhouette' as const,
          palette: { primary: '#0a1128', accent: '#00f0ff' }
        }
      ];

  const totalSliceFrames = sliceFrameRange.endFrame - sliceFrameRange.startFrame;
  const rawBeats = parsed.beats ?? [];
  const beatCount = Math.max(1, rawBeats.length);
  const framesPerBeat = Math.floor(totalSliceFrames / beatCount);

  const normalizedBeats: StoryBeat[] = [];

  for (let i = 0; i < beatCount; i++) {
    const rb = rawBeats[i] ?? {};
    const beatId = rb.beatId ?? `beat_${String(i).padStart(2, '0')}`;
    const startFrame = rb.startFrame !== undefined ? Math.max(0, rb.startFrame) : i * framesPerBeat;
    const endFrame = rb.endFrame !== undefined ? Math.max(startFrame + 1, rb.endFrame) : (i === beatCount - 1 ? totalSliceFrames : (i + 1) * framesPerBeat);

    // Normalize set
    let kitId: 'ARCHITECTURAL_INTERIOR' | 'EXTERIOR_URBAN_VISTA' = 'ARCHITECTURAL_INTERIOR';
    if (rb.set?.kitId && CANONICAL_SETS.includes(rb.set.kitId as any)) {
      kitId = rb.set.kitId as any;
    } else if (rb.set?.kitId) {
      const lower = rb.set.kitId.toLowerCase();
      let mappedKit: 'ARCHITECTURAL_INTERIOR' | 'EXTERIOR_URBAN_VISTA' | undefined = SET_FALLBACK_MAP[lower];
      if (!mappedKit) {
        for (const [key, val] of Object.entries(SET_FALLBACK_MAP)) {
          if (lower.includes(key)) {
            mappedKit = val;
            break;
          }
        }
      }
      kitId = mappedKit ?? 'ARCHITECTURAL_INTERIOR';
      unfulfilled.push({
        beatId,
        requestedEntity: rb.set.kitId,
        entityType: 'set',
        reason: 'Requested set is outside the closed parametric kit vocabulary',
        fallbackApplied: kitId
      });
    }

    const variantId = (['moody_night', 'dramatic_twilight', 'storm_overcast', 'clean_minimal'].includes(rb.set?.variantId as any))
      ? (rb.set!.variantId as any)
      : 'moody_night';

    // Normalize tone
    const toneRaw = rb.emotionalTone?.toLowerCase() ?? 'reflective';
    const emotionalTone = CANONICAL_TONES.includes(toneRaw as any) ? (toneRaw as any) : 'reflective';

    // Normalize actions
    const rawActions = rb.actions && rb.actions.length > 0
      ? rb.actions
      : [{ instanceId: cast[0].instanceId, verb: 'walk_to' }];

    const actions: CharacterActionDirective[] = rawActions.map((act) => {
      let verb: ActionVerbType = 'walk_to';
      if (CANONICAL_VERBS.includes(act.verb as any)) {
        verb = act.verb as ActionVerbType;
      } else {
        const lower = act.verb.toLowerCase();
        let mappedVerb: ActionVerbType | undefined = VERB_FALLBACK_MAP[lower];
        if (!mappedVerb) {
          for (const [key, val] of Object.entries(VERB_FALLBACK_MAP)) {
            if (lower.includes(key)) {
              mappedVerb = val;
              break;
            }
          }
        }
        verb = mappedVerb ?? 'walk_to';
        unfulfilled.push({
          beatId,
          requestedEntity: act.verb,
          entityType: 'verb',
          reason: 'Action verb is outside the closed parametric verb vocabulary',
          fallbackApplied: verb
        });
      }

      // Target mapping
      let target: VerbTarget | undefined;
      if (typeof act.target === 'object' && act.target && 'kind' in act.target) {
        target = act.target as VerbTarget;
      } else if (typeof act.target === 'string') {
        target = { kind: 'character', targetId: act.target };
      }

      // Prop socket
      const validSockets = ['hand_r', 'hand_l', 'torso', 'head'];
      const propSocket = validSockets.includes(act.propSocket ?? '') ? (act.propSocket as any) : undefined;

      return {
        instanceId: act.instanceId,
        verb,
        ...(target ? { target } : {}),
        speedNorm: typeof act.speedNorm === 'number' && Number.isFinite(act.speedNorm) ? Math.max(0.2, Math.min(2.5, act.speedNorm)) : 1.0,
        intensityNorm: typeof act.intensityNorm === 'number' && Number.isFinite(act.intensityNorm) ? Math.max(0, Math.min(1, act.intensityNorm)) : 0.7,
        ...(propSocket ? { propSocket } : {}),
        ...(act.associatedPropId ? { associatedPropId: act.associatedPropId } : {})
      };
    });

    // Normalize camera
    const validFramings = ['EXTREME_WIDE', 'WIDE', 'MEDIUM', 'CLOSE_UP', 'INSERT'];
    const validMovements = ['STATIC', 'PAN', 'DOLLY', 'TILT', 'ARC'];
    const framing = validFramings.includes(rb.camera?.framing ?? '') ? (rb.camera!.framing as any) : (i % 2 === 0 ? 'WIDE' : 'MEDIUM');
    const movement = validMovements.includes(rb.camera?.movement ?? '') ? (rb.camera!.movement as any) : 'DOLLY';
    const lookRoom = ['left', 'right', 'center'].includes(rb.camera?.lookRoom ?? '') ? (rb.camera!.lookRoom as any) : 'center';

    normalizedBeats.push({
      beatId,
      startFrame,
      endFrame,
      lyricSnippet: rb.lyricSnippet ?? '',
      emotionalTone,
      narrativeSubtext: rb.narrativeSubtext ?? `Story beat ${i + 1} narrative execution`,
      presentCharacters: rb.presentCharacters && rb.presentCharacters.length > 0 ? rb.presentCharacters : [cast[0].instanceId],
      set: {
        kitId,
        variantId,
        landmarkProps: rb.set?.landmarkProps ?? (kitId === 'ARCHITECTURAL_INTERIOR' ? ['desk', 'chair', 'coffee_cup'] : ['lamppost', 'curb']),
        ...(rb.set?.landmarkPlacements ? { landmarkPlacements: rb.set.landmarkPlacements } : {}),
        atmosphericDensity: typeof rb.set?.atmosphericDensity === 'number' ? Math.max(0, Math.min(1, rb.set.atmosphericDensity)) : 0.5
      },
      actions,
      camera: {
        framing,
        movement,
        focalCharacterId: rb.camera?.focalCharacterId ?? cast[0].instanceId,
        lookRoom,
        dutchAngleDeg: typeof rb.camera?.dutchAngleDeg === 'number' ? Math.max(-15, Math.min(15, rb.camera.dutchAngleDeg)) : 0
      },
      ...(rb.transition === 'cut' || rb.transition === 'dissolve' || rb.transition === 'dip_to_black'
        ? { transition: rb.transition }
        : {}),
      ...(typeof rb.transitionDurationFrames === 'number'
        ? { transitionDurationFrames: Math.max(0, Math.min(60, rb.transitionDurationFrames)) }
        : {})
    });
  }

  // Ensure contiguous non-overlapping frame ranges
  for (let j = 0; j < normalizedBeats.length; j++) {
    if (j > 0) {
      normalizedBeats[j].startFrame = normalizedBeats[j - 1].endFrame;
      if (normalizedBeats[j].endFrame <= normalizedBeats[j].startFrame) {
        normalizedBeats[j].endFrame = normalizedBeats[j].startFrame + 30;
      }
    }
  }

  const contract: StoryBeatContract = {
    projectId,
    songDurationSec,
    fps,
    sliceFrameRange: {
      startFrame: 0,
      endFrame: normalizedBeats[normalizedBeats.length - 1].endFrame
    },
    cast,
    beats: normalizedBeats,
    unfulfilledRequests: unfulfilled
  };

  return StoryBeatContractSchema.parse(contract);
}
