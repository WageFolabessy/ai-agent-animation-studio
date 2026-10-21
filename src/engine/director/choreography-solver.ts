import type { AssetRigContract } from '../../schemas/rig.contract.js';
import type { DirectorStoryboardContract } from '../../schemas/storyboard.contract.js';
import type {
  ChoreographyContract,
  EntityTrack,
  EntityTrackKeyframe,
  MorphBinding,
  MorphKeyframeItem
} from '../../schemas/choreography.contract.js';
import type { StorySpecContract } from '../../schemas/story-spec.contract.js';
import { computeLeadCharacterWorldPos } from './shot-planner.js';

function resolveClipIdForSection(
  sectionType?: string,
  energyBand?: string,
  narrativeIntent?: string
): string {
  const type = sectionType?.toUpperCase();
  const intent = (narrativeIntent ?? '').toLowerCase();

  if (type === 'INTRO') return 'stalk_crouch';
  if (type === 'OUTRO') return 'exhausted_walk';
  if (type === 'SOLO') return 'combat_clash';
  if (type === 'CHORUS' || energyBand === 'PEAK') {
    return intent.includes('scream') || intent.includes('defian')
      ? 'defiant_scream'
      : 'evade_leap';
  }
  return 'sprint_frenzy';
}

export function solveChoreography(
  spec: StorySpecContract,
  storyboard: DirectorStoryboardContract,
  rigs: Map<string, AssetRigContract>
): ChoreographyContract {
  const tracks: EntityTrack[] = [];
  const shots = storyboard.shots;
  const castMap = new Map(spec.cast.map((c) => [c.instanceId, c]));

  let accumulatedPoseClock = 0;

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const startFrame = shot.frameRange.startFrameInclusive;
    const endFrame = shot.frameRange.endFrameExclusive;
    const lastFrame = Math.max(startFrame, endFrame - 1);
    const duration = Math.max(1, endFrame - startFrame);

    // Find section corresponding to shot via exact boundary lookup
    const sectionSpec = spec.sections.find(
      (s) => startFrame >= s.startFrame && startFrame < s.endFrame
    ) ?? spec.sections[spec.sections.length - 1];

    for (const rigId of shot.activeRigIds) {
      const rig = rigs.get(rigId);
      const isCastMember = castMap.has(rigId);

      if (isCastMember && rig) {
        const castItem = spec.cast.find((c) => c.instanceId === rigId);
        const archetype = castItem?.archetypeId ?? (rig.id.includes('drone') ? 'aerial_drone' : rig.id.includes('hound') || rig.id.includes('beast') ? 'quadruped_beast' : 'biped_runner');

        if (archetype === 'aerial_drone') {
          // Active Sinusoidal Dive & Swoop Pursuit Drone (Z = -40)
          const droneKeyframes: EntityTrackKeyframe[] = [];
          const step = Math.max(12, Math.floor(duration / 4));
          for (let f = startFrame; f < endFrame; f += step) {
            const x = f * 0.45 + 110 + 10 * Math.sin(0.04 * f);
            const y = 175 + 45 * Math.cos(0.06 * f);
            const rotZ = Math.sin(0.04 * f) * 8;
            droneKeyframes.push({
              frame: f,
              position: [Number(x.toFixed(2)), Number(y.toFixed(2)), -40],
              rotationZDegrees: Number(rotZ.toFixed(2)),
              scale: [1, 1],
              opacity: 1,
              easing: 'linear'
            });
          }
          const lastX = lastFrame * 0.45 + 110 + 10 * Math.sin(0.04 * lastFrame);
          const lastY = 175 + 45 * Math.cos(0.06 * lastFrame);
          const lastRotZ = Math.sin(0.04 * lastFrame) * 8;
          if (droneKeyframes.length === 0 || droneKeyframes[droneKeyframes.length - 1].frame < lastFrame) {
            droneKeyframes.push({
              frame: lastFrame,
              position: [Number(lastX.toFixed(2)), Number(lastY.toFixed(2)), -40],
              rotationZDegrees: Number(lastRotZ.toFixed(2)),
              scale: [1, 1],
              opacity: 1,
              easing: 'linear'
            });
          }

          tracks.push({
            shotId: shot.id,
            rigId,
            transform: { keyframes: droneKeyframes },
            morphKeyframes: {},
            morphBindings: []
          });
          continue;
        }

        if (archetype === 'quadruped_beast') {
          // Active Ground Pursuit Hound (Z = 0, Y = 50)
          const beastStartX = startFrame * 0.45 - 140;
          const beastEndX = lastFrame * 0.45 - 60;
          const beastKeyframes: EntityTrackKeyframe[] = [
            {
              frame: startFrame,
              position: [Number(beastStartX.toFixed(2)), 50, 0],
              rotationZDegrees: 0,
              scale: [1, 1],
              opacity: 1,
              easing: 'linear'
            },
            {
              frame: lastFrame,
              position: [Number(beastEndX.toFixed(2)), 50, 0],
              rotationZDegrees: 0,
              scale: [1, 1],
              opacity: 1,
              easing: 'linear'
            }
          ];

          tracks.push({
            shotId: shot.id,
            rigId,
            transform: { keyframes: beastKeyframes },
            pose: {
              timeScale: 1.4,
              startPoseFrame: Number((accumulatedPoseClock % 24).toFixed(4))
            },
            morphKeyframes: {},
            morphBindings: []
          });
          continue;
        }

        // Character entity track (biped_runner)
        const directive = sectionSpec?.castDirectives?.find((d) => d.instanceId === rigId);
        const facing = rig.facingDirection ?? 'right';

        // Calculate positions using shared pure trajectory solver for lockstep camera tracking
        const startPos = computeLeadCharacterWorldPos(startFrame, sectionSpec, rigId);
        const endPos = computeLeadCharacterWorldPos(lastFrame, sectionSpec, rigId);

        let startX = startPos[0];
        let endX = endPos[0];

        // Ensure anti-moonwalk alignment: +X movement for right-facing
        if (facing === 'right' && endX <= startX) {
          endX = startX + 0.45 * Math.max(1, lastFrame - startFrame);
        }

        const deltaX = endX - startX;
        const speedPerFrame = deltaX / duration;
        const timeScale = Number(Math.max(0.4, Math.min(2.5, speedPerFrame * 2.2)).toFixed(2));
        const startPoseFrame = Number((accumulatedPoseClock % 24).toFixed(4));
        accumulatedPoseClock += duration * timeScale;

        const keyframes: EntityTrackKeyframe[] = [
          {
            frame: startFrame,
            position: [Number(startX.toFixed(2)), startPos[1], startPos[2]],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastFrame,
            position: [Number(endX.toFixed(2)), endPos[1], endPos[2]],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 1,
            easing: 'linear'
          }
        ];

        // Morph bindings and blinks if rig has morphTopology
        const morphBindings: MorphBinding[] = [];
        const morphKeyframes: Record<string, MorphKeyframeItem[]> = {};

        if (rig.morphTopology && rig.morphTopology.targets.length > 0) {
          const targetNames = new Set(rig.morphTopology.targets.map((t) => t.name));

          if (targetNames.has('mouthOpen')) {
            morphBindings.push({
              target: 'mouthOpen',
              source: 'audio.bands.presence',
              gain: 1.4,
              bias: 0.05,
              spring: { zeta: 0.7, omega: 28 }
            });
          }

          if (targetNames.has('browRaise')) {
            morphBindings.push({
              target: 'browRaise',
              source: 'audio.bands.bass',
              gain: 0.9,
              bias: 0.1
            });
          }

          if (targetNames.has('blink')) {
            // Natural periodic blink every ~50 frames
            const blinks: MorphKeyframeItem[] = [];
            for (let f = startFrame + 20; f < endFrame; f += 50) {
              blinks.push(
                { frame: f, weight: 0 },
                { frame: f + 2, weight: 1 },
                { frame: f + 4, weight: 0 }
              );
            }
            morphKeyframes.blink = blinks;
          }
        }

        // Resolve active motion preset from directive, falling back to section and shot nuance
        const canonicalBipedPresets = new Set([
          'stalk_crouch',
          'sprint_frenzy',
          'evade_leap',
          'defiant_scream',
          'combat_clash',
          'exhausted_walk'
        ]);

        let clipId: string;
        const rawPreset = directive?.motionPreset;

        if (rawPreset && canonicalBipedPresets.has(rawPreset)) {
          clipId = rawPreset;
        } else if (rawPreset === 'sprint' || rawPreset === 'stride') {
          clipId = 'sprint_frenzy';
        } else if (rawPreset === 'stalk' || rawPreset === 'idle') {
          clipId = 'stalk_crouch';
        } else if (rawPreset === 'evade') {
          clipId = 'evade_leap';
        } else {
          clipId = resolveClipIdForSection(
            shot.actNumber === 1 ? 'INTRO' : shot.actNumber === 3 ? 'SOLO' : 'VERSE',
            undefined,
            sectionSpec?.narrativeIntent
          );
        }

        // Shot-framing nuance: On CLOSE_UP shots during vocal or peak sections, trigger 'defiant_scream'
        if (shot.framing === 'CLOSE_UP' && (sectionSpec?.narrativeIntent?.toLowerCase().includes('vocal') || sectionSpec?.narrativeIntent?.toLowerCase().includes('scream') || shot.actNumber >= 2)) {
          clipId = 'defiant_scream';
        } else if (shot.framing === 'WIDE' && clipId === 'defiant_scream') {
          clipId = 'evade_leap';
        }

        tracks.push({
          shotId: shot.id,
          rigId,
          transform: { keyframes },
          pose: {
            timeScale,
            startPoseFrame,
            clipId
          },
          morphKeyframes,
          morphBindings
        });
      } else {
        // Static or environment rig
        tracks.push({
          shotId: shot.id,
          rigId,
          transform: {
            keyframes: [
              {
                frame: startFrame,
                position: [0, 100, -300],
                rotationZDegrees: 0,
                scale: [1, 1],
                opacity: 1,
                easing: 'linear'
              }
            ]
          },
          morphKeyframes: {},
          morphBindings: []
        });
      }
    }
  }

  return {
    projectId: spec.projectId,
    tracks
  };
}
