import type { Vec2, Vec3 } from '../../schemas/primitives.schema.js';
import type { CastRole, InteractionBehavior } from '../../schemas/story-spec.contract.js';

export interface RelationalBlockingInput {
  readonly behavior: InteractionBehavior;
  readonly protagonistStartPos: Vec3;
  readonly protagonistEndPos: Vec3;
  readonly protagonistScale?: number;
  readonly partnerBaseY: number;
  readonly partnerScale?: number;
  readonly partnerRole?: CastRole;
  readonly isTheatrical?: boolean;
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
  readonly cameraFocusMidpointStart: Vec3;
  readonly cameraFocusMidpointEnd: Vec3;
}

/**
 * Computes interpersonal multi-character blocking (Pillar 2 of Theatrical Narrative Architecture):
 *   Delta X = X_partner - X_protagonist
 *
 * Supports:
 * - FACE_TO_FACE: Characters face each other across the stage (flipX_partner = -flipX_protagonist).
 * - DUET_PERFORMANCE: Characters stand side-by-side facing the camera/audience.
 * - PARALLEL_WALK: Characters walk side-by-side with synchronized lateral progression.
 * - PURSUIT_AND_CONFRONTATION: Antagonist closes the gap toward the protagonist.
 * - SOLO: Default companion offset.
 */
export class RelationalBlockingSolver {
  public static solve(input: RelationalBlockingInput): RelationalBlockingSolution {
    const {
      behavior,
      protagonistStartPos,
      protagonistEndPos,
      protagonistScale = 1.0,
      partnerBaseY,
      partnerScale = 1.0,
      partnerRole = 'PARTNER'
    } = input;

    const pScaleVec: Vec2 = [protagonistScale, protagonistScale];

    switch (behavior) {
      case 'FACE_TO_FACE': {
        // Protagonist remains at their stage mark facing right (+X);
        // Partner stands across at +deltaX facing left (-X, mirrored via negative scaleX).
        const deltaX = 56;
        const pX = Number(protagonistStartPos[0].toFixed(2));
        const partnerX = Number((pX + deltaX).toFixed(2));

        const pStart: Vec3 = [pX, protagonistStartPos[1], protagonistStartPos[2]];
        const pEnd: Vec3 = [Number(protagonistEndPos[0].toFixed(2)), protagonistEndPos[1], protagonistEndPos[2]];
        const partStart: Vec3 = [partnerX, partnerBaseY, -4];
        const partEnd: Vec3 = [partnerX, partnerBaseY, -4];

        const deltaXEnd = Number((partnerX - protagonistEndPos[0]).toFixed(2));
        const midX = Number(((pX + partnerX) / 2).toFixed(2));
        const midY = Number(((protagonistStartPos[1] + partnerBaseY) / 2).toFixed(2));

        return {
          behavior,
          protagonistStartPos: pStart,
          protagonistEndPos: pEnd,
          protagonistScale: pScaleVec,
          partnerStartPos: partStart,
          partnerEndPos: partEnd,
          // Negative X scale mirrors the partner to face left (-X) toward the protagonist
          partnerScale: [-Math.abs(partnerScale), Math.abs(partnerScale)],
          deltaXStart: deltaX,
          deltaXEnd,
          cameraFocusMidpointStart: [midX, midY, -2],
          cameraFocusMidpointEnd: [midX, midY, -2]
        };
      }

      case 'DUET_PERFORMANCE': {
        const deltaX = 48;
        const pX = Number(protagonistStartPos[0].toFixed(2));
        const partnerX = Number((pX + deltaX).toFixed(2));

        const pStart: Vec3 = [pX, protagonistStartPos[1], protagonistStartPos[2]];
        const pEnd: Vec3 = [Number(protagonistEndPos[0].toFixed(2)), protagonistEndPos[1], protagonistEndPos[2]];
        const partStart: Vec3 = [partnerX, partnerBaseY, -8];
        const partEnd: Vec3 = [Number((protagonistEndPos[0] + deltaX).toFixed(2)), partnerBaseY, -8];

        const midX = Number(((pX + partnerX) / 2).toFixed(2));
        const midY = Number(((protagonistStartPos[1] + partnerBaseY) / 2).toFixed(2));

        return {
          behavior,
          protagonistStartPos: pStart,
          protagonistEndPos: pEnd,
          protagonistScale: pScaleVec,
          partnerStartPos: partStart,
          partnerEndPos: partEnd,
          partnerScale: [Math.abs(partnerScale), Math.abs(partnerScale)],
          deltaXStart: deltaX,
          deltaXEnd: deltaX,
          cameraFocusMidpointStart: [midX, midY, -4],
          cameraFocusMidpointEnd: [midX, midY, -4]
        };
      }

      case 'PARALLEL_WALK': {
        const offsetX = -34;
        const offsetZ = -14;
        const partStartX = Number((protagonistStartPos[0] + offsetX).toFixed(2));
        const partEndX = Number(
          Math.max(partStartX, protagonistEndPos[0] + offsetX).toFixed(2)
        );

        const partStart: Vec3 = [partStartX, partnerBaseY, offsetZ];
        const partEnd: Vec3 = [partEndX, partnerBaseY, offsetZ];

        const dStart = Number((partStartX - protagonistStartPos[0]).toFixed(2));
        const dEnd = Number((partEndX - protagonistEndPos[0]).toFixed(2));

        return {
          behavior,
          protagonistStartPos,
          protagonistEndPos,
          protagonistScale: pScaleVec,
          partnerStartPos: partStart,
          partnerEndPos: partEnd,
          partnerScale: [Math.abs(partnerScale), Math.abs(partnerScale)],
          deltaXStart: dStart,
          deltaXEnd: dEnd,
          cameraFocusMidpointStart: [
            Number(((protagonistStartPos[0] + partStartX) / 2).toFixed(2)),
            protagonistStartPos[1],
            offsetZ / 2
          ],
          cameraFocusMidpointEnd: [
            Number(((protagonistEndPos[0] + partEndX) / 2).toFixed(2)),
            protagonistEndPos[1],
            offsetZ / 2
          ]
        };
      }

      case 'PURSUIT_AND_CONFRONTATION': {
        const startOffset = -84;
        const endOffset = -42;
        const rawStartX = protagonistStartPos[0] + startOffset;
        const rawEndX = Math.max(rawStartX, protagonistEndPos[0] + endOffset);

        const partStartX = Number(rawStartX.toFixed(2));
        const partEndX = Number(rawEndX.toFixed(2));
        const partStart: Vec3 = [partStartX, partnerBaseY, -10];
        const partEnd: Vec3 = [partEndX, partnerBaseY, -10];

        const dStart = Number((partStartX - protagonistStartPos[0]).toFixed(2));
        const dEnd = Number((partEndX - protagonistEndPos[0]).toFixed(2));

        return {
          behavior,
          protagonistStartPos,
          protagonistEndPos,
          protagonistScale: pScaleVec,
          partnerStartPos: partStart,
          partnerEndPos: partEnd,
          partnerScale: [Math.abs(partnerScale), Math.abs(partnerScale)],
          deltaXStart: dStart,
          deltaXEnd: dEnd,
          cameraFocusMidpointStart: [
            Number(((protagonistStartPos[0] + partStartX) / 2).toFixed(2)),
            protagonistStartPos[1],
            -5
          ],
          cameraFocusMidpointEnd: [
            Number(((protagonistEndPos[0] + partEndX) / 2).toFixed(2)),
            protagonistEndPos[1],
            -5
          ]
        };
      }

      case 'SOLO':
      default: {
        const offsetX = partnerRole === 'BACKGROUND_CHORUS' ? 42 : -40;
        const offsetZ = partnerRole === 'BACKGROUND_CHORUS' ? -35 : 0;
        const partStartX = Number((protagonistStartPos[0] + offsetX).toFixed(2));
        const partEndX = Number(
          Math.max(partStartX, protagonistEndPos[0] + offsetX).toFixed(2)
        );
        const partStart: Vec3 = [partStartX, partnerBaseY, offsetZ];
        const partEnd: Vec3 = [partEndX, partnerBaseY, offsetZ];

        const dStart = Number((partStartX - protagonistStartPos[0]).toFixed(2));
        const dEnd = Number((partEndX - protagonistEndPos[0]).toFixed(2));

        return {
          behavior: 'SOLO',
          protagonistStartPos,
          protagonistEndPos,
          protagonistScale: pScaleVec,
          partnerStartPos: partStart,
          partnerEndPos: partEnd,
          partnerScale: [Math.abs(partnerScale), Math.abs(partnerScale)],
          deltaXStart: dStart,
          deltaXEnd: dEnd,
          cameraFocusMidpointStart: protagonistStartPos,
          cameraFocusMidpointEnd: protagonistEndPos
        };
      }
    }
  }
}
