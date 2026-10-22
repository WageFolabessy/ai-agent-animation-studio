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
import { ArchetypeFactory } from '../library/archetype-factory.js';
import {
  computeClipStrideLength,
  computeMusicalMotionParameters,
  buildUnifiedMotionPlan,
  globalTrajectorySolver
} from './trajectory-solver.js';

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
  rigs: Map<string, AssetRigContract>,
  framesPerBeat?: number
): ChoreographyContract {
  const tracks: EntityTrack[] = [];
  const shots = storyboard.shots;
  const castMap = new Map(spec.cast.map((c) => [c.instanceId, c]));

  const leadRigId = spec.cast[0]?.instanceId ?? Array.from(rigs.keys())[0] ?? 'lead';
  const leadRig =
    rigs.get(leadRigId) ??
    ArchetypeFactory.build({
      instanceId: leadRigId,
      spec: {
        instanceId: leadRigId,
        archetypeId: spec.cast[0]?.archetypeId ?? 'biped_runner',
        scale: 1.0,
        accessories: []
      }
    });

  const effectiveFramesPerBeat = framesPerBeat ?? globalTrajectorySolver.getFramesPerBeat();
  globalTrajectorySolver.setFramesPerBeat(effectiveFramesPerBeat);

  const motionPlan = buildUnifiedMotionPlan({
    storyboardShots: storyboard.shots.map((s) => ({
      id: s.id,
      frameRange: s.frameRange,
      framing: s.framing,
      actNumber: s.actNumber
    })),
    storySpec: spec,
    rig: leadRig,
    framesPerBeat: effectiveFramesPerBeat
  });

  globalTrajectorySolver.setMotionPlan(motionPlan);
  const shotPlanMap = new Map(motionPlan.map((p) => [p.shotId, p]));

  // Independent per-character pose clocks and last clip tracking
  const entityPoseClocks = new Map<string, number>();
  const entityLastClips = new Map<string, { clipId: string; loopFrames: number }>();

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const startFrame = shot.frameRange.startFrameInclusive;
    const endFrame = shot.frameRange.endFrameExclusive;
    const lastFrame = Math.max(startFrame, endFrame - 1);
    const duration = Math.max(1, endFrame - startFrame);

    const sectionSpec =
      spec.sections.find((s) => startFrame >= s.startFrame && startFrame < s.endFrame) ??
      spec.sections[spec.sections.length - 1];

    const leadPlan = shotPlanMap.get(shot.id);
    const leadStartX = leadPlan ? leadPlan.startX : 0;
    const leadSpeed = leadPlan ? leadPlan.rootSpeed : 0;
    const leadEndX = leadStartX + leadSpeed * (lastFrame - startFrame);

    for (const rigId of shot.activeRigIds) {
      const rig = rigs.get(rigId);
      const isCastMember = castMap.has(rigId);

      if (isCastMember && rig) {
        const castItem = spec.cast.find((c) => c.instanceId === rigId);
        const archetype =
          castItem?.archetypeId ??
          (rig.id.includes('drone')
            ? 'aerial_drone'
            : rig.id.includes('hound') || rig.id.includes('beast')
              ? 'quadruped_beast'
              : 'biped_runner');

        if (archetype === 'aerial_drone') {
          // Free flight pursuit path defined relative to lead character's actual trajectory
          const droneKeyframes: EntityTrackKeyframe[] = [];
          const step = Math.max(12, Math.floor(duration / 4));
          for (let f = startFrame; f < endFrame; f += step) {
            const leadXAtF = leadStartX + leadSpeed * (f - startFrame);
            const x = leadXAtF + 110;
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
          const leadXLast = leadStartX + leadSpeed * (lastFrame - startFrame);
          const lastX = leadXLast + 110;
          const lastY = 175 + 45 * Math.cos(0.06 * lastFrame);
          const lastRotZ = Math.sin(0.04 * lastFrame) * 8;
          if (
            droneKeyframes.length === 0 ||
            droneKeyframes[droneKeyframes.length - 1].frame < lastFrame
          ) {
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

        const isLead = rigId === leadRigId;

        if (archetype === 'quadruped_beast') {
          const isLeadMoving = leadSpeed > 0;
          const quadClipId = isLeadMoving ? 'beast_gallop' : 'beast_idle';
          const quadActiveClip =
            (rig.poseClips && rig.poseClips[quadClipId]) ?? rig.poseInterpolation;
          const quadLoopFrames = quadActiveClip?.loopFrames ?? 24;

          const quadStride = computeClipStrideLength(
            rig,
            quadActiveClip ?? { keyframes: [], interpolationMode: 'linear' },
            quadClipId
          );
          const quadMotion = computeMusicalMotionParameters(
            quadActiveClip ?? { keyframes: [], interpolationMode: 'linear' },
            quadStride,
            effectiveFramesPerBeat,
            quadClipId
          );

          let quadStartX: number;
          let quadEndX: number;
          let quadTimeScale: number;

          if (isLead) {
            quadStartX = leadPlan ? leadPlan.startX : 0;
            quadTimeScale = leadPlan ? leadPlan.timeScale : quadMotion.timeScale;
            const quadSpeed = leadPlan ? leadPlan.rootSpeed : quadMotion.rootSpeed;
            quadEndX = quadStartX + quadSpeed * (lastFrame - startFrame);
          } else {
            // Quadruped pursuer: follows lead at -120 offset, stops when lead stops
            const quadOffsetX = -120;
            quadStartX = leadStartX + quadOffsetX;
            quadEndX = isLeadMoving ? leadEndX + quadOffsetX : quadStartX;
            quadTimeScale = quadMotion.timeScale;
          }

          const beastKeyframes: EntityTrackKeyframe[] = [
            {
              frame: startFrame,
              position: [Number(quadStartX.toFixed(2)), 50, 0],
              rotationZDegrees: 0,
              scale: [1, 1],
              opacity: 1,
              easing: 'linear'
            },
            {
              frame: lastFrame,
              position: [Number(quadEndX.toFixed(2)), 50, 0],
              rotationZDegrees: 0,
              scale: [1, 1],
              opacity: 1,
              easing: 'linear'
            }
          ];

          // Independent pose clock for quadruped with per-clip loopFrames
          const quadLastClock = entityPoseClocks.get(rigId) ?? 0;
          const quadLastClipInfo = entityLastClips.get(rigId);
          let quadStartPoseFrame: number;

          if (quadLastClipInfo && quadLastClipInfo.clipId !== quadClipId) {
            const normalizedPhase =
              (((quadLastClock % quadLastClipInfo.loopFrames) + quadLastClipInfo.loopFrames) %
                quadLastClipInfo.loopFrames) /
              quadLastClipInfo.loopFrames;
            quadStartPoseFrame = Number((normalizedPhase * quadLoopFrames).toFixed(4));
          } else {
            quadStartPoseFrame = Number(
              (((quadLastClock % quadLoopFrames) + quadLoopFrames) % quadLoopFrames).toFixed(4)
            );
          }

          entityPoseClocks.set(rigId, quadStartPoseFrame + duration * quadTimeScale);
          entityLastClips.set(rigId, { clipId: quadClipId, loopFrames: quadLoopFrames });

          tracks.push({
            shotId: shot.id,
            rigId,
            transform: { keyframes: beastKeyframes },
            pose: {
              clipId: quadClipId,
              timeScale: quadTimeScale,
              startPoseFrame: quadStartPoseFrame
            },
            morphKeyframes: {},
            morphBindings: []
          });
          continue;
        }

        // Biped Character (Lead or Companion)
        let clipId: string;
        let timeScale: number;
        let rootSpeed: number;
        let startPos: [number, number, number];
        let endPos: [number, number, number];

        if (isLead && leadPlan) {
          clipId = leadPlan.clipId;
          timeScale = leadPlan.timeScale;
          rootSpeed = leadPlan.rootSpeed;
          startPos = [leadPlan.startX, 75, 0];
          endPos = [leadPlan.startX + leadPlan.rootSpeed * (lastFrame - startFrame), 75, 0];
        } else {
          // Companion biped runner
          const directive = sectionSpec?.castDirectives?.find((d) => d.instanceId === rigId);
          const rawPreset = directive?.motionPreset;
          const canonicalBipedPresets = new Set([
            'stalk_crouch',
            'sprint_frenzy',
            'evade_leap',
            'defiant_scream',
            'combat_clash',
            'exhausted_walk'
          ]);

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

          const activeClip = (rig.poseClips && rig.poseClips[clipId]) ?? rig.poseInterpolation;
          const fallbackClip = { keyframes: [], interpolationMode: 'linear' as const };
          const strideLength = computeClipStrideLength(rig, activeClip ?? fallbackClip, clipId);
          const motion = computeMusicalMotionParameters(
            activeClip ?? fallbackClip,
            strideLength,
            effectiveFramesPerBeat,
            clipId
          );
          timeScale = motion.timeScale;
          rootSpeed = motion.rootSpeed;

          const companionOffset = -40;
          startPos = [leadStartX + companionOffset, 75, 0];
          endPos = [leadStartX + companionOffset + rootSpeed * (lastFrame - startFrame), 75, 0];
        }

        const activeClip = (rig.poseClips && rig.poseClips[clipId]) ?? rig.poseInterpolation;
        const loopFrames = activeClip?.loopFrames ?? 24;

        // Independent Per-Character Pose Clock with Continuous Phase Carry-Over
        const lastClock = entityPoseClocks.get(rigId) ?? 0;
        const lastClipInfo = entityLastClips.get(rigId);
        let startPoseFrame: number;

        if (lastClipInfo && lastClipInfo.clipId !== clipId) {
          const normalizedPhase =
            (((lastClock % lastClipInfo.loopFrames) + lastClipInfo.loopFrames) %
              lastClipInfo.loopFrames) /
            lastClipInfo.loopFrames;
          startPoseFrame = Number((normalizedPhase * loopFrames).toFixed(4));
        } else {
          startPoseFrame = Number(
            (((lastClock % loopFrames) + loopFrames) % loopFrames).toFixed(4)
          );
        }

        const nextClock = startPoseFrame + duration * timeScale;
        entityPoseClocks.set(rigId, nextClock);
        entityLastClips.set(rigId, { clipId, loopFrames });

        const keyframes: EntityTrackKeyframe[] = [
          {
            frame: startFrame,
            position: [Number(startPos[0].toFixed(2)), startPos[1], startPos[2]],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastFrame,
            position: [Number(endPos[0].toFixed(2)), endPos[1], endPos[2]],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 1,
            easing: 'linear'
          }
        ];

        // Morph bindings and blinks
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
