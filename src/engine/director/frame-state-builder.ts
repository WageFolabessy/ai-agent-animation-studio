import type { DirectorStoryboardContract } from '../../schemas/storyboard.contract.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../../schemas/audio.contract.js';
import type { AssetRigContract } from '../../schemas/rig.contract.js';
import type { ChoreographyContract } from '../../schemas/choreography.contract.js';
import type {
  FrameStateContract,
  ActiveEntityState,
  ActiveLyricState
} from '../../schemas/frame.contract.js';
import { ShotSequencer } from './shot-sequencer.js';
import { CameraShakeSystem } from './camera-shake.js';
import { ChoreographySystem, evaluateEntityTrack, type EvaluatedTrackState } from './choreography.js';
import { samplePoseTrack, evaluateSecondaryMotion } from '../rigging/deformer.js';
import { computeSkeletonFK, applyAffine2D, getSkeletonJointMap } from '../rigging/kinematics.js';
import { solveTwoBoneArmIK, worldToRigLocal } from '../rigging/ik-leg-solver.js';
import { CANONICAL_BIPED_SOCKETS } from '../library/prop-factory.js';
import type { IkTarget, GazeTarget } from '../../schemas/choreography.contract.js';

function evaluateHandIkTarget(
  targetsForHand: readonly IkTarget[],
  frameIndex: number
): { targetWorld: [number, number, number]; weight: number } | null {
  if (!targetsForHand || targetsForHand.length === 0) return null;

  let keyframed: IkTarget[] | undefined = (targetsForHand as unknown as { _keyframed?: IkTarget[] })._keyframed;
  if (!keyframed) {
    keyframed = targetsForHand.filter((t) => t.frame !== undefined).sort((a, b) => a.frame! - b.frame!);
    (targetsForHand as unknown as { _keyframed?: IkTarget[] })._keyframed = keyframed;
  }
  if (keyframed.length > 0) {
    if (keyframed.length === 1) {
      const kf = keyframed[0];
      return { targetWorld: kf.targetWorld, weight: kf.weight ?? 1.0 };
    }
    if (frameIndex <= keyframed[0].frame!) {
      const kf = keyframed[0];
      return { targetWorld: kf.targetWorld, weight: kf.weight ?? 1.0 };
    }
    const lastKf = keyframed[keyframed.length - 1];
    if (frameIndex >= lastKf.frame!) {
      return { targetWorld: lastKf.targetWorld, weight: lastKf.weight ?? 1.0 };
    }
    for (let i = 0; i < keyframed.length - 1; i++) {
      const kf0 = keyframed[i];
      const kf1 = keyframed[i + 1];
      if (frameIndex >= kf0.frame! && frameIndex <= kf1.frame!) {
        const dt = kf1.frame! - kf0.frame!;
        const tau = dt > 0 ? (frameIndex - kf0.frame!) / dt : 0;
        const targetWorld: [number, number, number] = [
          kf0.targetWorld[0] + (kf1.targetWorld[0] - kf0.targetWorld[0]) * tau,
          kf0.targetWorld[1] + (kf1.targetWorld[1] - kf0.targetWorld[1]) * tau,
          kf0.targetWorld[2] + (kf1.targetWorld[2] - kf0.targetWorld[2]) * tau
        ];
        const weight = (kf0.weight ?? 1.0) + ((kf1.weight ?? 1.0) - (kf0.weight ?? 1.0)) * tau;
        return { targetWorld, weight };
      }
    }
  }

  const activeSpan = targetsForHand.find(
    (t) => t.startFrame !== undefined && t.endFrame !== undefined && frameIndex >= t.startFrame && frameIndex < t.endFrame
  );
  if (activeSpan) {
    return { targetWorld: activeSpan.targetWorld, weight: activeSpan.weight ?? 1.0 };
  }

  const staticTarget = targetsForHand.find((t) => t.frame === undefined && t.startFrame === undefined);
  if (staticTarget) {
    return { targetWorld: staticTarget.targetWorld, weight: staticTarget.weight ?? 1.0 };
  }

  return null;
}

function evaluateGazeTargetAtFrame(
  gazeTargets: readonly GazeTarget[],
  frameIndex: number
): { targetWorld: [number, number, number]; weight: number } | null {
  if (!gazeTargets || gazeTargets.length === 0) return null;

  let keyframed: GazeTarget[] | undefined = (gazeTargets as unknown as { _keyframed?: GazeTarget[] })._keyframed;
  if (!keyframed) {
    keyframed = gazeTargets.filter((t) => t.frame !== undefined).sort((a, b) => a.frame! - b.frame!);
    (gazeTargets as unknown as { _keyframed?: GazeTarget[] })._keyframed = keyframed;
  }
  if (keyframed.length > 0) {
    if (keyframed.length === 1) {
      const kf = keyframed[0];
      return { targetWorld: kf.targetWorld, weight: kf.weight ?? 1.0 };
    }
    if (frameIndex <= keyframed[0].frame!) {
      const kf = keyframed[0];
      return { targetWorld: kf.targetWorld, weight: kf.weight ?? 1.0 };
    }
    const lastKf = keyframed[keyframed.length - 1];
    if (frameIndex >= lastKf.frame!) {
      return { targetWorld: lastKf.targetWorld, weight: lastKf.weight ?? 1.0 };
    }
    for (let i = 0; i < keyframed.length - 1; i++) {
      const kf0 = keyframed[i];
      const kf1 = keyframed[i + 1];
      if (frameIndex >= kf0.frame! && frameIndex <= kf1.frame!) {
        const dt = kf1.frame! - kf0.frame!;
        const tau = dt > 0 ? (frameIndex - kf0.frame!) / dt : 0;
        const targetWorld: [number, number, number] = [
          kf0.targetWorld[0] + (kf1.targetWorld[0] - kf0.targetWorld[0]) * tau,
          kf0.targetWorld[1] + (kf1.targetWorld[1] - kf0.targetWorld[1]) * tau,
          kf0.targetWorld[2] + (kf1.targetWorld[2] - kf0.targetWorld[2]) * tau
        ];
        const weight = (kf0.weight ?? 1.0) + ((kf1.weight ?? 1.0) - (kf0.weight ?? 1.0)) * tau;
        return { targetWorld, weight };
      }
    }
  }

  const activeSpan = gazeTargets.find(
    (t) => t.startFrame !== undefined && t.endFrame !== undefined && frameIndex >= t.startFrame && frameIndex < t.endFrame
  );
  if (activeSpan) {
    return { targetWorld: activeSpan.targetWorld, weight: activeSpan.weight ?? 1.0 };
  }

  const staticTarget = gazeTargets.find((t) => t.frame === undefined && t.startFrame === undefined);
  if (staticTarget) {
    return { targetWorld: staticTarget.targetWorld, weight: staticTarget.weight ?? 1.0 };
  }

  return null;
}

const CANONICAL_BIPED_SOCKETS_MAP = new Map(
  CANONICAL_BIPED_SOCKETS.map((s) => [s.id, s])
);

interface PreIndexedRig {
  jointMap: Map<string, import('../../schemas/rig.contract.js').PlanarJoint>;
  armRUpper: import('../../schemas/rig.contract.js').PlanarJoint | undefined;
  armRLower: import('../../schemas/rig.contract.js').PlanarJoint | undefined;
  armLUpper: import('../../schemas/rig.contract.js').PlanarJoint | undefined;
  armLLower: import('../../schemas/rig.contract.js').PlanarJoint | undefined;
  headJoint: import('../../schemas/rig.contract.js').PlanarJoint | undefined;
  l1R: number;
  l2R: number;
  l1L: number;
  l2L: number;
  sockets: Map<string, { jointId: string; localOffset2D: readonly [number, number] }>;
}

interface PreIndexedTrack {
  targetsHandR: readonly IkTarget[];
  targetsHandL: readonly IkTarget[];
  gazeTargets: readonly GazeTarget[];
}

export interface FrameStateBuilderOptions {
  storyboard: DirectorStoryboardContract;
  audioManifest: AudioAnalysisManifest;
  rigs: Map<string, AssetRigContract>;
  choreography: ChoreographyContract;
  getAudioFeatureAtFrame: (f: number) => AudioFrameFeature;
  seed?: number;
}

/**
 * Pure frame state builder that transforms high-level storyboard, audio, and choreography
 * contracts into an exact FrameStateContract for any requested frame index.
 */
export class FrameStateBuilder {
  private readonly storyboard: DirectorStoryboardContract;
  private readonly audioManifest: AudioAnalysisManifest;
  private readonly rigs: Map<string, AssetRigContract>;
  private readonly sequencer: ShotSequencer;
  private readonly shakeSystem: CameraShakeSystem;
  private readonly choreoSystem: ChoreographySystem;
  private readonly getAudioFeature: (f: number) => AudioFrameFeature;
  private readonly preIndexedRigs = new Map<string, PreIndexedRig>();
  private readonly preIndexedTracks = new Map<string, PreIndexedTrack>();

  constructor(options: FrameStateBuilderOptions) {
    this.storyboard = options.storyboard;
    this.audioManifest = options.audioManifest;
    this.rigs = options.rigs;
    this.sequencer = new ShotSequencer(options.storyboard);
    this.shakeSystem = new CameraShakeSystem({
      seed: options.seed ?? 42,
      fps: options.storyboard.fps
    });
    this.choreoSystem = new ChoreographySystem(options.choreography);
    this.getAudioFeature = options.getAudioFeatureAtFrame;

    for (const [rigId, rig] of this.rigs) {
      if (rig.skeleton) {
        const jointMap = getSkeletonJointMap(rig.skeleton);
        const armRUpper = jointMap.get('arm_r_upper');
        const armRLower = jointMap.get('arm_r_lower');
        const armLUpper = jointMap.get('arm_l_upper');
        const armLLower = jointMap.get('arm_l_lower');
        const headJoint = jointMap.get('head');
        const sockets = new Map<string, { jointId: string; localOffset2D: readonly [number, number] }>();
        if (rig.sockets) {
          for (const s of rig.sockets) {
            sockets.set(s.id, s);
          }
        }
        this.preIndexedRigs.set(rigId, {
          jointMap,
          armRUpper,
          armRLower,
          armLUpper,
          armLLower,
          headJoint,
          l1R: armRUpper?.length ?? 18,
          l2R: armRLower?.length ?? 16,
          l1L: armLUpper?.length ?? 18,
          l2L: armLLower?.length ?? 16,
          sockets
        });
      }
    }

    if (options.choreography.tracks) {
      for (const track of options.choreography.tracks) {
        const ikTargets = track.ikTargets ?? [];
        const targetsHandR = ikTargets.filter((t) => t.hand === 'hand_r');
        const targetsHandL = ikTargets.filter((t) => t.hand === 'hand_l');
        const gazeTargets = track.gazeTargets ?? [];
        this.preIndexedTracks.set(`${track.shotId}:${track.rigId}`, {
          targetsHandR,
          targetsHandL,
          gazeTargets
        });
      }
    }
  }

  private findActiveLyric(frameIndex: number): ActiveLyricState | null {
    const lyrics = this.audioManifest.lyrics;
    let low = 0;
    let high = lyrics.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const lyric = lyrics[mid];
      const start = lyric.frameRange.startFrameInclusive;
      const end = lyric.frameRange.endFrameExclusive;

      if (frameIndex < start) {
        high = mid - 1;
      } else if (frameIndex >= end) {
        low = mid + 1;
      } else {
        const duration = end - start;
        const progress = duration > 0 ? (frameIndex - start) / duration : 0;
        return {
          lineId: lyric.id,
          text: lyric.text,
          progress: Math.max(0, Math.min(1, progress)),
          emphasis: lyric.emphasis
        };
      }
    }
    return null;
  }

  public buildFrameState(frameIndex: number): FrameStateContract {
    const fps = this.storyboard.fps;
    const timeSeconds = frameIndex / fps;

    // 1. Identify active shot & normalized progress
    const { shot, normalizedProgress } = this.sequencer.getShotForFrame(frameIndex);

    // 2. Base interpolated camera (with optional theatrical CAMERA_PAN transition-in)
    let baseCamera = this.sequencer.interpolateCamera(shot, normalizedProgress);
    let transitionOverlayOpacity: number | undefined;

    if (shot.transitionIn && shot.transitionIn.durationFrames > 0) {
      const localFrame = frameIndex - shot.frameRange.startFrameInclusive;
      if (localFrame >= 0 && localFrame < shot.transitionIn.durationFrames) {
        const u = localFrame / shot.transitionIn.durationFrames;
        if (shot.transitionIn.type === 'CROSS_FADE' || shot.transitionIn.type === 'dissolve') {
          transitionOverlayOpacity = Number(((1 - u) * 0.85).toFixed(3));
        } else if (shot.transitionIn.type === 'dip_to_black') {
          transitionOverlayOpacity = Number((1 - u).toFixed(3));
        } else if (shot.transitionIn.type === 'CAMERA_PAN') {
          const panShift = (1 - u) * (1 - u) * -40;
          baseCamera = {
            ...baseCamera,
            position: [
              baseCamera.position[0] + panShift,
              baseCamera.position[1],
              baseCamera.position[2]
            ],
            target: [
              baseCamera.target[0] + panShift,
              baseCamera.target[1],
              baseCamera.target[2]
            ]
          };
        }
      }
    }

    if (shot.transitionOut && shot.transitionOut.durationFrames > 0) {
      const framesFromEnd = shot.frameRange.endFrameExclusive - 1 - frameIndex;
      if (framesFromEnd >= 0 && framesFromEnd < shot.transitionOut.durationFrames) {
        const u = 1 - (framesFromEnd / shot.transitionOut.durationFrames);
        let outOpacity = 0;
        if (shot.transitionOut.type === 'CROSS_FADE' || shot.transitionOut.type === 'dissolve') {
          outOpacity = Number((u * 0.85).toFixed(3));
        } else if (shot.transitionOut.type === 'dip_to_black') {
          outOpacity = Number(u.toFixed(3));
        }
        transitionOverlayOpacity = transitionOverlayOpacity !== undefined
          ? Math.max(transitionOverlayOpacity, outOpacity)
          : outOpacity;
      }
    }

    // 3. Audio-reactive camera trauma shake
    const camera = this.shakeSystem.applyShake(
      baseCamera,
      frameIndex,
      this.getAudioFeature,
      shot.palette
    );

    // 4. Audio features
    const audio = this.getAudioFeature(frameIndex);

    // 5. Active lyric caption
    const lyric = this.findActiveLyric(frameIndex);

    // 6. Active entities for the shot
    const entities: ActiveEntityState[] = [];
    const evaluatedTrackMap = new Map<string, EvaluatedTrackState>();
    const entityFkMap = new Map<string, Map<string, import('../rigging/kinematics.js').Affine2D>>();

    for (const rigId of shot.activeRigIds) {
      const rig = this.rigs.get(rigId);
      if (!rig) continue;

      const track = this.choreoSystem.getTrack(shot.id, rigId);

      if (track) {
        const trackState = evaluateEntityTrack(track, frameIndex, fps, this.getAudioFeature);
        evaluatedTrackMap.set(rigId, trackState);

        const poseResult = samplePoseTrack(
          rig,
          frameIndex,
          trackState.shotStartFrame ?? shot.frameRange.startFrameInclusive,
          trackState.timeScale,
          trackState.startPoseFrame,
          trackState.clipId,
          trackState.vRoot
        );

        const jointAngles = evaluateSecondaryMotion(
          rig,
          frameIndex,
          fps,
          this.getAudioFeature,
          poseResult.jointAngles
        );

        if (rig.skeleton) {
          const preRig = this.preIndexedRigs.get(rigId);
          const jointMap = preRig?.jointMap ?? getSkeletonJointMap(rig.skeleton);
          const preTrack = this.preIndexedTracks.get(`${shot.id}:${rigId}`);

          const targetsR = preTrack?.targetsHandR ?? [];
          const targetsL = preTrack?.targetsHandL ?? [];
          const gazeTargets = preTrack?.gazeTargets ?? (track.gazeTargets ?? []);

          const activeIkR = targetsR.length > 0 ? evaluateHandIkTarget(targetsR, frameIndex) : null;
          const activeIkL = targetsL.length > 0 ? evaluateHandIkTarget(targetsL, frameIndex) : null;
          const activeGaze = gazeTargets.length > 0 ? evaluateGazeTargetAtFrame(gazeTargets, frameIndex) : null;

          const hasIkOrGaze = Boolean(
            (activeIkR && activeIkR.weight > 1e-4) ||
            (activeIkL && activeIkL.weight > 1e-4) ||
            (activeGaze && activeGaze.weight > 1e-4)
          );

          const crouchDrop = 75.0 - trackState.worldPosition[1];
          if (crouchDrop > 2.0 && jointAngles['torso'] !== undefined) {
            const deficitEst = crouchDrop / 0.75;
            jointAngles['torso'] = Math.min(22.0, 3.0 + deficitEst * 1.1);
          }

          const fkPre = hasIkOrGaze
            ? computeSkeletonFK(rig.skeleton, jointAngles, poseResult.jointOffsets)
            : null;

          // 1. Post-clip IK pass (applied after clip sampling and secondary motion)
          if (activeIkR && activeIkR.weight > 1e-4 && fkPre) {
            const upperJoint = preRig?.armRUpper ?? jointMap.get('arm_r_upper');
            const lowerJoint = preRig?.armRLower ?? jointMap.get('arm_r_lower');
            if (upperJoint && lowerJoint) {
              const upperTransform = fkPre.get(upperJoint.id);
              const parentId = upperJoint.parentId ?? 'torso';
              const parentTransform = fkPre.get(parentId);
              if (upperTransform) {
                const shoulderPos: [number, number] = [upperTransform.tx, upperTransform.ty];
                const parentAngleDeg = parentTransform
                  ? (Math.atan2(parentTransform.b, parentTransform.a) * 180) / Math.PI
                  : 0;
                const l1 = preRig?.l1R ?? (upperJoint.length ?? 18);
                const l2 = preRig?.l2R ?? (lowerJoint.length ?? 16);
                const localTarget = worldToRigLocal(
                  [activeIkR.targetWorld[0], activeIkR.targetWorld[1]],
                  trackState.worldPosition,
                  trackState.scale
                );
                const ikResult = solveTwoBoneArmIK(
                  shoulderPos,
                  localTarget,
                  l1,
                  l2,
                  parentAngleDeg,
                  1,
                  upperJoint.constraintsDeg,
                  lowerJoint.constraintsDeg
                );
                const clipUpper = jointAngles[upperJoint.id] ?? upperJoint.rotationZDegrees;
                const clipLower = jointAngles[lowerJoint.id] ?? lowerJoint.rotationZDegrees;
                const w = activeIkR.weight;
                jointAngles[upperJoint.id] = clipUpper + (ikResult.upperAngleDeg - clipUpper) * w;
                jointAngles[lowerJoint.id] = clipLower + (ikResult.lowerAngleDeg - clipLower) * w;
              }
            }
          }

          if (activeIkL && activeIkL.weight > 1e-4 && fkPre) {
            const upperJoint = preRig?.armLUpper ?? jointMap.get('arm_l_upper');
            const lowerJoint = preRig?.armLLower ?? jointMap.get('arm_l_lower');
            if (upperJoint && lowerJoint) {
              const upperTransform = fkPre.get(upperJoint.id);
              const parentId = upperJoint.parentId ?? 'torso';
              const parentTransform = fkPre.get(parentId);
              if (upperTransform) {
                const shoulderPos: [number, number] = [upperTransform.tx, upperTransform.ty];
                const parentAngleDeg = parentTransform
                  ? (Math.atan2(parentTransform.b, parentTransform.a) * 180) / Math.PI
                  : 0;
                const l1 = preRig?.l1L ?? (upperJoint.length ?? 18);
                const l2 = preRig?.l2L ?? (lowerJoint.length ?? 16);
                const localTarget = worldToRigLocal(
                  [activeIkL.targetWorld[0], activeIkL.targetWorld[1]],
                  trackState.worldPosition,
                  trackState.scale
                );
                const ikResult = solveTwoBoneArmIK(
                  shoulderPos,
                  localTarget,
                  l1,
                  l2,
                  parentAngleDeg,
                  1,
                  upperJoint.constraintsDeg,
                  lowerJoint.constraintsDeg
                );
                const clipUpper = jointAngles[upperJoint.id] ?? upperJoint.rotationZDegrees;
                const clipLower = jointAngles[lowerJoint.id] ?? lowerJoint.rotationZDegrees;
                const w = activeIkL.weight;
                jointAngles[upperJoint.id] = clipUpper + (ikResult.upperAngleDeg - clipUpper) * w;
                jointAngles[lowerJoint.id] = clipLower + (ikResult.lowerAngleDeg - clipLower) * w;
              }
            }
          }

          // 2. Post-clip Gaze pass
          if (activeGaze && activeGaze.weight > 1e-4 && fkPre) {
            const headJoint = preRig?.headJoint ?? jointMap.get('head');
            if (headJoint) {
              const parentId = headJoint.parentId ?? 'torso';
              const parentTransform = fkPre.get(parentId);
              const headTransform = fkPre.get('head');

              if (headTransform) {
                const sx = trackState.scale[0] !== 0 ? trackState.scale[0] : 1;
                const sy = trackState.scale[1] !== 0 ? trackState.scale[1] : 1;
                const headWorldX = trackState.worldPosition[0] + headTransform.tx * sx;
                const headWorldY = trackState.worldPosition[1] + headTransform.ty * sy;

                const dxLocal = (activeGaze.targetWorld[0] - headWorldX) / sx;
                const dyLocal = (activeGaze.targetWorld[1] - headWorldY) / sy;
                const desiredPitchDeg = (Math.atan2(dyLocal, dxLocal) * 180) / Math.PI;

                const parentAngleDeg = parentTransform
                  ? (Math.atan2(parentTransform.b, parentTransform.a) * 180) / Math.PI
                  : 0;
                const headRelativeDeg = desiredPitchDeg - parentAngleDeg;
                const constraints = headJoint.constraintsDeg ?? [-40, 40];
                const clampedHeadDeg = Math.max(constraints[0], Math.min(constraints[1], headRelativeDeg));

                const clipHead = jointAngles['head'] ?? headJoint.rotationZDegrees;
                jointAngles['head'] = clipHead + (clampedHeadDeg - clipHead) * activeGaze.weight;
              }
            }
          }

          entityFkMap.set(rigId, computeSkeletonFK(rig.skeleton, jointAngles, poseResult.jointOffsets));
        }

        entities.push({
          rigId,
          worldPosition: trackState.worldPosition,
          worldRotationZDegrees: trackState.worldRotationZDegrees,
          scale: trackState.scale,
          jointAngles,
          jointOffsets: poseResult.jointOffsets,
          morphWeights: trackState.morphWeights,
          opacity: trackState.opacity
        });
      } else {
        // Fallback to static rig defaults
        entities.push({
          rigId,
          worldPosition: rig.baseTransform.position,
          worldRotationZDegrees: rig.baseTransform.rotationZDegrees,
          scale: rig.baseTransform.scale,
          jointAngles: {},
          jointOffsets: {},
          morphWeights: {},
          opacity: 1
        });
      }
    }

    // Dynamic prop attachment pass: project attached props from owner's FK socket in camera plane
    const entityMap = new Map<string, ActiveEntityState>();
    for (const entity of entities) {
      entityMap.set(entity.rigId, entity);
    }

    for (const entity of entities) {
      const trackState = evaluatedTrackMap.get(entity.rigId);
      const span = trackState?.activeAttachmentSpan;
      if (!span) continue;

      const ownerEntity = entityMap.get(span.ownerRigId);
      const ownerRig = this.rigs.get(span.ownerRigId);
      if (!ownerEntity || !ownerRig?.skeleton) continue;

      const fkMap = entityFkMap.get(span.ownerRigId) ??
        computeSkeletonFK(ownerRig.skeleton, ownerEntity.jointAngles, ownerEntity.jointOffsets);
      const preOwnerRig = this.preIndexedRigs.get(span.ownerRigId);
      const socket = preOwnerRig?.sockets.get(span.socketId) ??
        CANONICAL_BIPED_SOCKETS_MAP.get(span.socketId);

      const jointId = socket ? socket.jointId : span.socketId;
      const localOffset = socket ? socket.localOffset2D : [0, 0];
      const jointTransform = fkMap.get(jointId);

      if (jointTransform) {
        const socketLocal = applyAffine2D(jointTransform, localOffset as [number, number]);
        const sx = ownerEntity.scale[0] !== 0 ? ownerEntity.scale[0] : 1;
        const sy = ownerEntity.scale[1] !== 0 ? ownerEntity.scale[1] : 1;
        const scaledX = socketLocal[0] * sx;
        const scaledY = socketLocal[1] * sy;
        const rotRad = (ownerEntity.worldRotationZDegrees * Math.PI) / 180;
        const cosR = Math.cos(rotRad);
        const sinR = Math.sin(rotRad);
        const rotX = scaledX * cosR - scaledY * sinR;
        const rotY = scaledX * sinR + scaledY * cosR;

        entity.worldPosition = [
          ownerEntity.worldPosition[0] + rotX,
          ownerEntity.worldPosition[1] + rotY,
          ownerEntity.worldPosition[2] + 1e-3
        ];
        entity.scale = [
          Math.sign(ownerEntity.scale[0] || 1) * Math.abs(entity.scale[0]),
          entity.scale[1]
        ];
        // Enforce upright prop orientation against gravity unless inheritSocketRotation is set
        entity.worldRotationZDegrees = 0;
      }
    }

    return {
      frameIndex,
      timeSeconds,
      shotId: shot.id,
      camera,
      palette: shot.palette,
      audio,
      lyric,
      entities,
      ...(transitionOverlayOpacity !== undefined ? { transitionOverlayOpacity } : {})
    };
  }
}
