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
import type { AudioFrameFeature } from '../../schemas/audio.contract.js';
import { ArchetypeFactory } from '../library/archetype-factory.js';
import {
  TrajectorySolver,
  computeClipStrideLength,
  computeMusicalMotionParameters,
  buildUnifiedMotionPlan,
  globalTrajectorySolver,
  ARCHETYPE_CANONICAL_BASE_Y,
  NON_LOCOMOTION_CLIPS
} from './trajectory-solver.js';
import {
  RelationalBlockingSolver,
  computeRigHorizontalBounds,
  MIN_INTERPERSONAL_CLEARANCE
} from './relational-blocking-solver.js';
import {
  synthesizeVocalPerformanceKeyframes,
  type VocalLyricSpan
} from '../rigging/vocal-performance-solver.js';

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
  framesPerBeat?: number,
  solver?: TrajectorySolver,
  lyrics?: readonly VocalLyricSpan[],
  getAudioFeatureAtFrame?: (f: number) => AudioFrameFeature
): ChoreographyContract {
  const activeSolver = solver ?? new TrajectorySolver();
  const tracks: EntityTrack[] = [];
  const shots = storyboard.shots;
  const castMap = new Map(spec.cast.map((c) => [c.instanceId, c]));

  const leadRigId = spec.cast[0]?.instanceId ?? Array.from(rigs.keys())[0] ?? 'lead';
  const leadArchetypeId = spec.cast[0]?.archetypeId ?? 'biped_runner';
  const leadRig =
    rigs.get(leadRigId) ??
    ArchetypeFactory.build({
      instanceId: leadRigId,
      spec: {
        instanceId: leadRigId,
        archetypeId: leadArchetypeId,
        scale: 1.0,
        accessories: []
      }
    });

  const effectiveFramesPerBeat =
    framesPerBeat ?? (solver ? solver.getFramesPerBeat() : globalTrajectorySolver.getFramesPerBeat());
  activeSolver.setLeadArchetype(leadArchetypeId);
  activeSolver.setFramesPerBeat(effectiveFramesPerBeat);

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

  activeSolver.setMotionPlan(motionPlan);
  globalTrajectorySolver.setLeadArchetype(leadArchetypeId);
  globalTrajectorySolver.setFramesPerBeat(effectiveFramesPerBeat);
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

    let nonLeadBipedIndex = 0;

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

          let quadStartPos: [number, number, number];
          let quadEndPos: [number, number, number];
          let quadTimeScale: number;

          if (isLead) {
            quadStartPos = activeSolver.computeWorldPos(startFrame, sectionSpec, leadRigId);
            quadEndPos = activeSolver.computeWorldPos(lastFrame, sectionSpec, leadRigId);
            quadTimeScale = leadPlan ? leadPlan.timeScale : quadMotion.timeScale;
          } else {
            // Quadruped pursuer: derive minimum separation from actual rig bounds
            const leadBounds = computeRigHorizontalBounds(
              leadRig,
              leadPlan?.clipId ? [leadPlan.clipId] : undefined,
              spec.cast[0]?.scale ?? 1.0
            );
            const quadBounds = computeRigHorizontalBounds(
              rig,
              [quadClipId],
              castItem?.scale ?? 1.0
            );
            const minSepLeft = Math.ceil(
              quadBounds.maxX - leadBounds.minX + MIN_INTERPERSONAL_CLEARANCE
            );
            const quadOffsetX = -minSepLeft;
            const quadStartX = leadStartX + quadOffsetX;
            const quadEndX = isLeadMoving ? leadEndX + quadOffsetX : quadStartX;
            quadStartPos = [
              Number(quadStartX.toFixed(2)),
              ARCHETYPE_CANONICAL_BASE_Y.quadruped_beast,
              0
            ];
            quadEndPos = [
              Number(quadEndX.toFixed(2)),
              ARCHETYPE_CANONICAL_BASE_Y.quadruped_beast,
              0
            ];

            const frameSpan = Math.max(1, lastFrame - startFrame);
            const quadSpeed = (quadEndX - quadStartX) / frameSpan;
            if (quadSpeed > 0 && quadStride > 0) {
              const rawQuadTs = (quadSpeed * quadLoopFrames) / quadStride;
              if (rawQuadTs >= 0.6 && rawQuadTs <= 1.6) {
                quadTimeScale = Number(rawQuadTs.toFixed(4));
              } else if (rawQuadTs < 0.6) {
                quadTimeScale = 0.6;
                const lockedSpeed = (quadStride / quadLoopFrames) * 0.6;
                const adjustedEndX = quadStartX + lockedSpeed * frameSpan;
                quadEndPos = [
                  Number(adjustedEndX.toFixed(2)),
                  ARCHETYPE_CANONICAL_BASE_Y.quadruped_beast,
                  0
                ];
              } else {
                quadTimeScale = 1.6;
                const lockedSpeed = (quadStride / quadLoopFrames) * 1.6;
                const adjustedEndX = quadStartX + lockedSpeed * frameSpan;
                quadEndPos = [
                  Number(adjustedEndX.toFixed(2)),
                  ARCHETYPE_CANONICAL_BASE_Y.quadruped_beast,
                  0
                ];
              }
            } else {
              quadTimeScale = 1.0;
            }
          }

          const beastKeyframes: EntityTrackKeyframe[] = [
            {
              frame: startFrame,
              position: quadStartPos,
              rotationZDegrees: 0,
              scale: [1, 1],
              opacity: 1,
              easing: 'linear'
            },
            {
              frame: lastFrame,
              position: quadEndPos,
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
        let startPos: [number, number, number];
        let endPos: [number, number, number];
        let trackScale: [number, number] = [1, 1];
        let loopFrames = 24;

        const isTheatrical = Boolean(
          sectionSpec?.stagingMode === 'theatrical' || sectionSpec?.theatricalSetId
        );
        const interactionBehavior =
          sectionSpec?.interactionBehavior ?? (isTheatrical ? 'SOLO' : 'PARALLEL_WALK');

        if (isLead && leadPlan) {
          clipId = leadPlan.clipId;
          timeScale = leadPlan.timeScale;
          const rawStartPos = activeSolver.computeWorldPos(startFrame, sectionSpec, leadRigId);
          const rawEndPos = activeSolver.computeWorldPos(lastFrame, sectionSpec, leadRigId);

          if (
            spec.cast.length >= 2 &&
            shot.activeRigIds.length >= 2 &&
            (interactionBehavior === 'FACE_TO_FACE' || interactionBehavior === 'DUET_PERFORMANCE')
          ) {
            const partnerCast = spec.cast.find((c) => c.instanceId !== leadRigId);
            const partnerRig = partnerCast ? rigs.get(partnerCast.instanceId) : undefined;
            const blocking = RelationalBlockingSolver.solve({
              behavior: interactionBehavior,
              protagonistStartPos: rawStartPos,
              protagonistEndPos: rawEndPos,
              protagonistScale: spec.cast[0]?.scale ?? 1.0,
              protagonistRig: leadRig,
              protagonistClipId: clipId,
              partnerBaseY: 75,
              partnerScale: partnerCast?.scale ?? 1.0,
              partnerRole: partnerCast?.role,
              partnerRig,
              isTheatrical
            });
            startPos = blocking.protagonistStartPos;
            endPos = blocking.protagonistEndPos;
            trackScale = blocking.protagonistScale;
          } else {
            startPos = rawStartPos;
            endPos = rawEndPos;
          }
        } else {
          // Companion / Partner / Antagonist biped character
          const directive = sectionSpec?.castDirectives?.find((d) => d.instanceId === rigId);
          const rawPreset = directive?.motionPreset;
          const canonicalBipedPresets = new Set([
            'stalk_crouch',
            'sprint_frenzy',
            'evade_leap',
            'defiant_scream',
            'combat_clash',
            'exhausted_walk',
            'pop_vocal_sway',
            'stage_spin',
            'rhythmic_step',
            'crowd_cheer',
            'acoustic_strum',
            'rain_umbrella_walk',
            'bench_contemplation',
            'gazing_out_window',
            'slow_waltz',
            'headbang_riff',
            'collapse_to_knees'
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
          loopFrames = activeClip?.loopFrames ?? 24;
          const strideLength = computeClipStrideLength(rig, activeClip ?? fallbackClip, clipId);
          const motion = computeMusicalMotionParameters(
            activeClip ?? fallbackClip,
            strideLength,
            effectiveFramesPerBeat,
            clipId
          );
          timeScale = motion.timeScale;

          const leadStartVec = activeSolver.computeWorldPos(startFrame, sectionSpec, leadRigId);
          const leadEndVec = activeSolver.computeWorldPos(lastFrame, sectionSpec, leadRigId);
          const clearance = MIN_INTERPERSONAL_CLEARANCE + nonLeadBipedIndex * 90;
          nonLeadBipedIndex++;
          const blocking = RelationalBlockingSolver.solve({
            behavior: interactionBehavior,
            protagonistStartPos: leadStartVec,
            protagonistEndPos: leadEndVec,
            protagonistScale: spec.cast[0]?.scale ?? 1.0,
            protagonistRig: leadRig,
            protagonistClipId: leadPlan?.clipId,
            partnerBaseY: 75,
            partnerScale: castItem?.scale ?? 1.0,
            partnerRole: castItem?.role,
            partnerRig: rig,
            partnerClipId: clipId,
            isTheatrical,
            clearance
          });
          startPos = blocking.partnerStartPos;
          endPos = blocking.partnerEndPos;
          trackScale = blocking.partnerScale;

          const frameSpan = Math.max(1, lastFrame - startFrame);
          const partnerDisplacement = endPos[0] - startPos[0];
          const partnerSpeed = partnerDisplacement / frameSpan;
          const isLocomotion = !NON_LOCOMOTION_CLIPS.has(clipId) && strideLength > 0;

          if (isLocomotion) {
            const natSpeed = strideLength / loopFrames;
            const rawPartnerTs = partnerSpeed > 0 ? partnerSpeed / natSpeed : 0;
            if (rawPartnerTs >= 0.6 && rawPartnerTs <= 1.6 && partnerSpeed > 0) {
              timeScale = Number(rawPartnerTs.toFixed(4));
            } else {
              const isMovement =
                interactionBehavior === 'PURSUIT_AND_CONFRONTATION' ||
                interactionBehavior === 'PARALLEL_WALK';
              if (isMovement) {
                const targetTs = leadPlan?.timeScale ?? 0.8;
                timeScale = Math.max(0.6, Math.min(1.6, targetTs));
                const lockedSpeed = natSpeed * timeScale;
                const partnerMinSep = blocking.minRequiredSeparation ?? 12;
                let targetEndX = leadEndVec[0] - partnerMinSep;
                let targetStartX = targetEndX - lockedSpeed * frameSpan;
                startPos = [Number(targetStartX.toFixed(2)), startPos[1], startPos[2]];
                endPos = [Number(targetEndX.toFixed(2)), endPos[1], endPos[2]];
                const adjustedSpeed = (endPos[0] - startPos[0]) / frameSpan;
                timeScale = Number(
                  Math.max(0.6, Math.min(1.6, (adjustedSpeed * loopFrames) / strideLength)).toFixed(
                    4
                  )
                );
              } else {
                const inPlaceClip =
                  rawPreset && NON_LOCOMOTION_CLIPS.has(rawPreset)
                    ? rawPreset
                    : sectionSpec?.narrativeIntent?.toLowerCase().includes('vocal')
                      ? 'pop_vocal_sway'
                      : 'rhythmic_step';
                clipId = inPlaceClip;
                timeScale = 1.0;
                endPos = [startPos[0], startPos[1], startPos[2]];
              }
            }
          } else {
            timeScale = 1.0;
          }
        }

        const activeClip = (rig.poseClips && rig.poseClips[clipId]) ?? rig.poseInterpolation;
        loopFrames = activeClip?.loopFrames ?? 24;

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

        const effectiveTrackScale: [number, number] =
          endPos[0] < startPos[0] - 1e-3 && trackScale[0] > 0
            ? [-Math.abs(trackScale[0]), trackScale[1]]
            : endPos[0] > startPos[0] + 1e-3 && trackScale[0] < 0
              ? [Math.abs(trackScale[0]), trackScale[1]]
              : trackScale;

        const keyframes: EntityTrackKeyframe[] = [
          {
            frame: startFrame,
            position: [Number(startPos[0].toFixed(2)), startPos[1], startPos[2]],
            rotationZDegrees: 0,
            scale: effectiveTrackScale,
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastFrame,
            position: [Number(endPos[0].toFixed(2)), endPos[1], endPos[2]],
            rotationZDegrees: 0,
            scale: effectiveTrackScale,
            opacity: 1,
            easing: 'linear'
          }
        ];

        // Morph bindings, phoneme lip-sync, and blinks
        const morphBindings: MorphBinding[] = [];
        const morphKeyframes: Record<string, MorphKeyframeItem[]> = {};

        if (rig.morphTopology && rig.morphTopology.targets.length > 0) {
          const targetNames = new Set(rig.morphTopology.targets.map((t) => t.name));

          if (targetNames.has('browRaise')) {
            morphBindings.push({
              target: 'browRaise',
              source: 'audio.bands.bass',
              gain: 0.9,
              bias: 0.1
            });
          }

          if (lyrics && lyrics.length > 0) {
            const vocalMorphs = synthesizeVocalPerformanceKeyframes({
              lyrics,
              shotStartFrame: startFrame,
              shotEndFrame: endFrame,
              emotionalTone: sectionSpec?.emotionalTone,
              availableTargets: targetNames,
              getAudioFeatureAtFrame
            });
            for (const [mName, mKeys] of Object.entries(vocalMorphs)) {
              morphKeyframes[mName] = mKeys;
            }
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
