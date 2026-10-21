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

    // Find section corresponding to shot
    const sectionIndex = Math.min(
      spec.sections.length - 1,
      Math.floor((startFrame / storyboard.totalFrames) * spec.sections.length)
    );
    const sectionSpec = spec.sections[sectionIndex];

    for (const rigId of shot.activeRigIds) {
      const rig = rigs.get(rigId);
      const isCastMember = castMap.has(rigId);

      if (isCastMember && rig) {
        // Character entity track
        const directive = sectionSpec?.castDirectives?.find((d) => d.instanceId === rigId);
        const facing = rig.facingDirection ?? 'right';

        // Calculate positions from waypoints or progressive tracking
        const defaultStartX = startFrame * 0.45;
        const defaultEndX = endFrame * 0.45;

        // Ensure anti-moonwalk alignment: +X movement for right-facing, -X for left-facing
        let startX = defaultStartX;
        let endX = defaultEndX;

        if (directive && directive.waypoints.length >= 2) {
          const wp0 = directive.waypoints[0];
          const wp1 = directive.waypoints[directive.waypoints.length - 1];
          const rawDelta = wp1.stagePosNorm[0] - wp0.stagePosNorm[0];
          if (facing === 'right' && rawDelta < 0) {
            // Flip to prevent moonwalking
            startX = defaultStartX;
            endX = defaultEndX;
          } else {
            startX = defaultStartX + wp0.stagePosNorm[0] * 120;
            endX = defaultStartX + wp1.stagePosNorm[0] * 120 + (endFrame - startFrame) * 0.45;
          }
        }

        if (facing === 'right' && endX < startX) {
          endX = startX + 10;
        }

        const deltaX = endX - startX;
        const speedPerFrame = deltaX / duration;
        const timeScale = Number(Math.max(0.4, Math.min(2.5, speedPerFrame * 2.2)).toFixed(2));
        const startPoseFrame = Number((accumulatedPoseClock % 24).toFixed(4));
        accumulatedPoseClock += duration * timeScale;

        const keyframes: EntityTrackKeyframe[] = [
          {
            frame: startFrame,
            position: [Number(startX.toFixed(2)), 75, -60],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastFrame,
            position: [Number(endX.toFixed(2)), 75, -60],
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

        tracks.push({
          shotId: shot.id,
          rigId,
          transform: { keyframes },
          pose: {
            timeScale,
            startPoseFrame
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
