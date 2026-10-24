import type { Vec2, Vec3 } from '../../schemas/primitives.schema.js';
import type { AssetRigContract } from '../../schemas/rig.contract.js';
import type { CastRole, InteractionBehavior } from '../../schemas/story-spec.contract.js';
import { ArchetypeFactory } from '../library/archetype-factory.js';
import { computeSkeletonFK, applyAffine2D } from '../rigging/kinematics.js';

export const MIN_INTERPERSONAL_CLEARANCE = 8.0;

export interface RigHorizontalBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly width: number;
}

let cachedDefaultProtagonistRig: AssetRigContract | undefined;
let cachedDefaultPartnerRig: AssetRigContract | undefined;

function getDefaultProtagonistRig(): AssetRigContract {
  if (!cachedDefaultProtagonistRig) {
    cachedDefaultProtagonistRig = ArchetypeFactory.build({
      instanceId: 'default_protagonist',
      spec: {
        instanceId: 'default_protagonist',
        archetypeId: 'biped_three_quarters',
        role: 'PROTAGONIST',
        viewAngle: 'three_quarter',
        scale: 1.0,
        accessories: ['electric_guitar']
      }
    });
  }
  return cachedDefaultProtagonistRig;
}

function getDefaultPartnerRig(): AssetRigContract {
  if (!cachedDefaultPartnerRig) {
    cachedDefaultPartnerRig = ArchetypeFactory.build({
      instanceId: 'default_partner',
      spec: {
        instanceId: 'default_partner',
        archetypeId: 'biped_three_quarters',
        role: 'PARTNER',
        viewAngle: 'three_quarter',
        scale: 1.0,
        accessories: ['microphone']
      }
    });
  }
  return cachedDefaultPartnerRig;
}

function poseKeyframeToJointMaps(kf: {
  readonly jointTransforms: readonly {
    readonly jointId: string;
    readonly rotationZDegrees: number;
    readonly localOffset2D?: Vec2;
  }[];
}): { jointAngles: Record<string, number>; jointOffsets: Record<string, Vec2> } {
  const jointAngles: Record<string, number> = {};
  const jointOffsets: Record<string, Vec2> = {};
  for (const jt of kf.jointTransforms) {
    jointAngles[jt.jointId] = jt.rotationZDegrees;
    if (jt.localOffset2D) {
      jointOffsets[jt.jointId] = jt.localOffset2D;
    }
  }
  return { jointAngles, jointOffsets };
}

const boundsCache = new WeakMap<AssetRigContract, Map<string, RigHorizontalBounds>>();

/**
 * Computes exact horizontal bounding extents [minX, maxX] of a rig across its rest pose
 * and active clip pose keyframes, including all body parts, accessories, and attached props.
 * Results are memoized per rig instance (rigs are immutable once built).
 */
export function computeRigHorizontalBounds(
  rig: AssetRigContract,
  clipIds?: readonly string[],
  scaleX = 1.0
): RigHorizontalBounds {
  let perRig = boundsCache.get(rig);
  if (!perRig) {
    perRig = new Map();
    boundsCache.set(rig, perRig);
  }
  const cacheKey = `${clipIds ? clipIds.join(',') : '*'}|${scaleX}`;
  const cached = perRig.get(cacheKey);
  if (cached) return cached;
  const result = computeRigHorizontalBoundsUncached(rig, clipIds, scaleX);
  perRig.set(cacheKey, result);
  return result;
}

function computeRigHorizontalBoundsUncached(
  rig: AssetRigContract,
  clipIds: readonly string[] | undefined,
  scaleX: number
): RigHorizontalBounds {
  const poses: Array<{
    jointAngles: Record<string, number>;
    jointOffsets: Record<string, Vec2>;
  }> = [{ jointAngles: {}, jointOffsets: {} }];

  if (clipIds && clipIds.length > 0) {
    for (const clipId of clipIds) {
      const clip = (rig.poseClips && rig.poseClips[clipId]) ?? rig.poseInterpolation;
      if (clip) {
        for (const kf of clip.keyframes) {
          poses.push(poseKeyframeToJointMaps(kf));
        }
      }
    }
  } else {
    if (rig.poseInterpolation) {
      for (const kf of rig.poseInterpolation.keyframes) {
        poses.push(poseKeyframeToJointMaps(kf));
      }
    }
    if (rig.poseClips) {
      for (const clip of Object.values(rig.poseClips)) {
        for (const kf of clip.keyframes) {
          poses.push(poseKeyframeToJointMaps(kf));
        }
      }
    }
  }

  let rawMinX = Infinity;
  let rawMaxX = -Infinity;

  for (const pose of poses) {
    const fk = rig.skeleton
      ? computeSkeletonFK(rig.skeleton, pose.jointAngles, pose.jointOffsets)
      : new Map();

    for (const part of rig.parts) {
      const jt = part.jointId ? fk.get(part.jointId) : undefined;
      const pts: Vec2[] = [];

      switch (part.shape.kind) {
        case 'rect': {
          const [w, h] = part.shape.size;
          pts.push([-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]);
          break;
        }
        case 'ellipse': {
          const [rx, ry] = part.shape.radius;
          pts.push([-rx, 0], [rx, 0], [0, -ry], [0, ry]);
          break;
        }
        case 'polygon': {
          for (const pt of part.shape.points) {
            pts.push(pt);
          }
          break;
        }
        case 'path': {
          for (const seg of part.shape.segments) {
            pts.push(seg.p0, seg.p1, seg.p2, seg.p3);
          }
          break;
        }
        case 'morph': {
          if (rig.morphTopology) {
            for (const seg of rig.morphTopology.baseSegments) {
              pts.push(seg.p0, seg.p1, seg.p2, seg.p3);
            }
          }
          break;
        }
      }

      const strokePad = (part.style.stroke?.width ?? 0) * 0.5;
      for (const p of pts) {
        const localP: Vec2 = [p[0] + part.localOffset2D[0], p[1] + part.localOffset2D[1]];
        const world2d = jt ? applyAffine2D(jt, localP) : localP;
        if (world2d[0] - strokePad < rawMinX) rawMinX = world2d[0] - strokePad;
        if (world2d[0] + strokePad > rawMaxX) rawMaxX = world2d[0] + strokePad;
      }
    }
  }

  if (!Number.isFinite(rawMinX) || !Number.isFinite(rawMaxX)) {
    rawMinX = -25;
    rawMaxX = 25;
  }

  const s = Number.isFinite(scaleX) && Math.abs(scaleX) > 1e-6 ? scaleX : 1.0;
  const scaledA = rawMinX * s;
  const scaledB = rawMaxX * s;
  const minX = Number(Math.min(scaledA, scaledB).toFixed(2));
  const maxX = Number(Math.max(scaledA, scaledB).toFixed(2));

  return {
    minX,
    maxX,
    width: Number((maxX - minX).toFixed(2))
  };
}

export interface RelationalBlockingInput {
  readonly behavior: InteractionBehavior;
  readonly protagonistStartPos: Vec3;
  readonly protagonistEndPos: Vec3;
  readonly protagonistScale?: number;
  readonly protagonistRig?: AssetRigContract;
  readonly protagonistClipId?: string;
  readonly partnerBaseY: number;
  readonly partnerScale?: number;
  readonly partnerRole?: CastRole;
  readonly partnerRig?: AssetRigContract;
  readonly partnerClipId?: string;
  readonly isTheatrical?: boolean;
  readonly clearance?: number;
}

export interface RelationalBlockingSolution {
  readonly behavior: InteractionBehavior;
  readonly protagonistStartPos: Vec3;
  readonly protagonistEndPos: Vec3;
  readonly protagonistScale: Vec2;
  readonly partnerStartPos: Vec3;
  readonly partnerEndPos: Vec3;
  readonly partnerScale: Vec2;
  readonly deltaXStart: number;
  readonly deltaXEnd: number;
  readonly minRequiredSeparation: number;
  readonly cameraFocusMidpointStart: Vec3;
  readonly cameraFocusMidpointEnd: Vec3;
}

/**
 * Computes interpersonal multi-character blocking:
 *   Delta X = X_partner - X_protagonist
 *
 * Minimum horizontal separation is derived directly from the rest-pose and clip-pose
 * geometry extents of both rigs (including body parts, accessories, and props) plus
 * a positive clearance margin, guaranteeing zero overlap and zero pass-through.
 */
export class RelationalBlockingSolver {
  public static solve(input: RelationalBlockingInput): RelationalBlockingSolution {
    const {
      behavior,
      protagonistStartPos,
      protagonistEndPos,
      protagonistScale = 1.0,
      protagonistRig,
      protagonistClipId,
      partnerBaseY,
      partnerScale = 1.0,
      partnerRole = 'PARTNER',
      partnerRig,
      partnerClipId,
      clearance = MIN_INTERPERSONAL_CLEARANCE
    } = input;

    const absLeadScale = Math.abs(protagonistScale);
    const absPartnerScale = Math.abs(partnerScale);
    const pScaleVec: Vec2 = [absLeadScale, absLeadScale];

    const resolvedLeadRig = protagonistRig ?? getDefaultProtagonistRig();
    const resolvedPartnerRig = partnerRig ?? getDefaultPartnerRig();
    const leadClips = protagonistClipId ? [protagonistClipId] : undefined;
    const partnerClips = partnerClipId ? [partnerClipId] : undefined;

    const pStartX = Number(protagonistStartPos[0].toFixed(2));
    const pEndX = Number(protagonistEndPos[0].toFixed(2));
    const leadEffectiveScaleX = pEndX < pStartX - 1e-3 ? -absLeadScale : absLeadScale;
    const leadBounds = computeRigHorizontalBounds(resolvedLeadRig, leadClips, leadEffectiveScaleX);

    switch (behavior) {
      case 'FACE_TO_FACE': {
        // Protagonist faces right (+X); Partner stands across facing left (-X, mirrored via negative scaleX).
        const partnerMirroredScaleX = -absPartnerScale;
        const partnerBounds = computeRigHorizontalBounds(
          resolvedPartnerRig,
          partnerClips,
          partnerMirroredScaleX
        );
        const minSepRight = Math.ceil(leadBounds.maxX - partnerBounds.minX + clearance);

        const maxLeadX = Math.max(pStartX, pEndX);
        const partnerX = Number((maxLeadX + minSepRight).toFixed(2));

        const pStart: Vec3 = [pStartX, protagonistStartPos[1], protagonistStartPos[2]];
        const pEnd: Vec3 = [pEndX, protagonistEndPos[1], protagonistEndPos[2]];
        const partStart: Vec3 = [partnerX, partnerBaseY, -4];
        const partEnd: Vec3 = [partnerX, partnerBaseY, -4];

        const deltaXStart = Number((partnerX - pStartX).toFixed(2));
        const deltaXEnd = Number((partnerX - pEndX).toFixed(2));
        const midX = Number(((pStartX + partnerX) / 2).toFixed(2));
        const midY = Number(((protagonistStartPos[1] + partnerBaseY) / 2).toFixed(2));

        return {
          behavior,
          protagonistStartPos: pStart,
          protagonistEndPos: pEnd,
          protagonistScale: pScaleVec,
          partnerStartPos: partStart,
          partnerEndPos: partEnd,
          partnerScale: [partnerMirroredScaleX, absPartnerScale],
          deltaXStart,
          deltaXEnd,
          minRequiredSeparation: minSepRight,
          cameraFocusMidpointStart: [midX, midY, -2],
          cameraFocusMidpointEnd: [midX, midY, -2]
        };
      }

      case 'DUET_PERFORMANCE': {
        const partnerBounds = computeRigHorizontalBounds(
          resolvedPartnerRig,
          partnerClips,
          absPartnerScale
        );
        const minSepRight = Math.ceil(leadBounds.maxX - partnerBounds.minX + clearance);

        const pStart: Vec3 = [pStartX, protagonistStartPos[1], protagonistStartPos[2]];
        const pEnd: Vec3 = [pEndX, protagonistEndPos[1], protagonistEndPos[2]];
        const partStartX = Number((Math.max(pStartX, pEndX) === pStartX ? pStartX + minSepRight : pStartX + minSepRight).toFixed(2));
        const partEndX = Number(Math.max(partStartX, pEndX + minSepRight).toFixed(2));
        const partStart: Vec3 = [partStartX, partnerBaseY, -8];
        const partEnd: Vec3 = [partEndX, partnerBaseY, -8];

        const deltaXStart = Number((partStartX - pStartX).toFixed(2));
        const deltaXEnd = Number((partEndX - pEndX).toFixed(2));
        const midX = Number(((pStartX + partStartX) / 2).toFixed(2));
        const midY = Number(((protagonistStartPos[1] + partnerBaseY) / 2).toFixed(2));

        return {
          behavior,
          protagonistStartPos: pStart,
          protagonistEndPos: pEnd,
          protagonistScale: pScaleVec,
          partnerStartPos: partStart,
          partnerEndPos: partEnd,
          partnerScale: [absPartnerScale, absPartnerScale],
          deltaXStart,
          deltaXEnd,
          minRequiredSeparation: minSepRight,
          cameraFocusMidpointStart: [midX, midY, -4],
          cameraFocusMidpointEnd: [midX, midY, -4]
        };
      }

      case 'PARALLEL_WALK': {
        const partnerBounds = computeRigHorizontalBounds(
          resolvedPartnerRig,
          partnerClips,
          absPartnerScale
        );
        const minSepLeft = Math.ceil(partnerBounds.maxX - leadBounds.minX + clearance);
        const offsetX = -minSepLeft;
        const offsetZ = -14;

        let partStartX: number;
        let partEndX: number;
        if (pEndX >= pStartX) {
          partStartX = Number((pStartX + offsetX).toFixed(2));
          partEndX = Number((pEndX + offsetX).toFixed(2));
        } else {
          // If protagonist moves left, place partner consistently behind/left of minimum X
          partStartX = Number((pEndX + offsetX).toFixed(2));
          partEndX = Number((pEndX + offsetX).toFixed(2));
        }

        const partStart: Vec3 = [partStartX, partnerBaseY, offsetZ];
        const partEnd: Vec3 = [partEndX, partnerBaseY, offsetZ];

        const dStart = Number((partStartX - pStartX).toFixed(2));
        const dEnd = Number((partEndX - pEndX).toFixed(2));

        return {
          behavior,
          protagonistStartPos,
          protagonistEndPos,
          protagonistScale: pScaleVec,
          partnerStartPos: partStart,
          partnerEndPos: partEnd,
          partnerScale: [absPartnerScale, absPartnerScale],
          deltaXStart: dStart,
          deltaXEnd: dEnd,
          minRequiredSeparation: minSepLeft,
          cameraFocusMidpointStart: [
            Number(((pStartX + partStartX) / 2).toFixed(2)),
            protagonistStartPos[1],
            offsetZ / 2
          ],
          cameraFocusMidpointEnd: [
            Number(((pEndX + partEndX) / 2).toFixed(2)),
            protagonistEndPos[1],
            offsetZ / 2
          ]
        };
      }

      case 'PURSUIT_AND_CONFRONTATION': {
        const partnerBounds = computeRigHorizontalBounds(
          resolvedPartnerRig,
          partnerClips,
          absPartnerScale
        );
        const minSepLeft = Math.ceil(partnerBounds.maxX - leadBounds.minX + clearance);
        const closingDistance = 42;
        const endOffset = -minSepLeft;
        const startOffset = -(minSepLeft + closingDistance);

        let partStartX: number;
        let partEndX: number;
        if (pEndX >= pStartX) {
          partStartX = Number((pStartX + startOffset).toFixed(2));
          partEndX = Number((pEndX + endOffset).toFixed(2));
        } else {
          partStartX = Number((pEndX + startOffset).toFixed(2));
          partEndX = Number((pEndX + endOffset).toFixed(2));
        }

        const partStart: Vec3 = [partStartX, partnerBaseY, -10];
        const partEnd: Vec3 = [partEndX, partnerBaseY, -10];

        const dStart = Number((partStartX - pStartX).toFixed(2));
        const dEnd = Number((partEndX - pEndX).toFixed(2));

        return {
          behavior,
          protagonistStartPos,
          protagonistEndPos,
          protagonistScale: pScaleVec,
          partnerStartPos: partStart,
          partnerEndPos: partEnd,
          partnerScale: [absPartnerScale, absPartnerScale],
          deltaXStart: dStart,
          deltaXEnd: dEnd,
          minRequiredSeparation: minSepLeft,
          cameraFocusMidpointStart: [
            Number(((pStartX + partStartX) / 2).toFixed(2)),
            protagonistStartPos[1],
            -5
          ],
          cameraFocusMidpointEnd: [
            Number(((pEndX + partEndX) / 2).toFixed(2)),
            protagonistEndPos[1],
            -5
          ]
        };
      }

      case 'SOLO':
      default: {
        // Note: In SOLO shots, shot-planner excludes partner from activeRigIds.
        // If RelationalBlockingSolver is invoked directly with SOLO, place partner at a
        // non-overlapping separation and background depth (-35) so it never overlaps lead.
        const partnerBounds = computeRigHorizontalBounds(
          resolvedPartnerRig,
          partnerClips,
          absPartnerScale
        );
        const minSepLeft = Math.ceil(partnerBounds.maxX - leadBounds.minX + clearance);
        const minSepRight = Math.ceil(leadBounds.maxX - partnerBounds.minX + clearance);
        const offsetX = partnerRole === 'BACKGROUND_CHORUS' ? minSepRight : -minSepLeft;
        const offsetZ = -35;

        const minLeadX = Math.min(pStartX, pEndX);
        const maxLeadX = Math.max(pStartX, pEndX);
        const partStartX = Number(
          ((offsetX > 0 ? maxLeadX : minLeadX) + offsetX).toFixed(2)
        );
        const partEndX = Number(
          Math.max(partStartX, (offsetX > 0 ? maxLeadX : pEndX) + offsetX).toFixed(2)
        );

        const partStart: Vec3 = [partStartX, partnerBaseY, offsetZ];
        const partEnd: Vec3 = [partEndX, partnerBaseY, offsetZ];

        const dStart = Number((partStartX - pStartX).toFixed(2));
        const dEnd = Number((partEndX - pEndX).toFixed(2));

        return {
          behavior: 'SOLO',
          protagonistStartPos,
          protagonistEndPos,
          protagonistScale: pScaleVec,
          partnerStartPos: partStart,
          partnerEndPos: partEnd,
          partnerScale: [absPartnerScale, absPartnerScale],
          deltaXStart: dStart,
          deltaXEnd: dEnd,
          minRequiredSeparation: offsetX > 0 ? minSepRight : minSepLeft,
          cameraFocusMidpointStart: protagonistStartPos,
          cameraFocusMidpointEnd: protagonistEndPos
        };
      }
    }
  }
}
