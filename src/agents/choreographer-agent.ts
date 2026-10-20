import {
  ChoreographyContractSchema,
  type ChoreographyContract,
  type EntityTrack
} from '../schemas/choreography.contract.js';
import type { ChoreographerAgentInput, LlmProvider } from './types.js';
import { CANONICAL_RIG_IDS, formatRepairFeedbackPrompt } from './director-agent.js';

/**
 * Builds a deterministic, schema-valid ChoreographyContract synchronized with
 * the DirectorStoryboardContract and AssetRigContract catalog.
 *
 * Key physical & continuity guarantees:
 * 1. Stationary environment rigs ("rig-skyline", "rig-factories", "rig-smoke-chimney")
 *    maintain identical world coordinates across all shot cuts.
 * 2. Character "rig-runner" translates strictly in +X (matching `facingDirection: "right"`)
 *    with `pose.timeScale` proportional to horizontal velocity ($\Delta x / \Delta f$)
 *    and continuous world handoff across shot boundaries.
 * 3. Particle emitter "rig-runner-aura" tracks the runner's world coordinates while
 *    "rig-smoke-chimney" remains anchored to the factory smokestack at [-150, 220, -380].
 */
export function buildDeterministicChoreography(
  input: ChoreographerAgentInput
): ChoreographyContract {
  const tracks: EntityTrack[] = [];
  const shots = input.storyboard.shots;

  // Continuous runner X waypoints across shots (strictly increasing in +X)
  const runnerWaypointsX = [-110, 0, 160, 295, 315];
  const runnerLoopFrames =
    input.rigs.get(CANONICAL_RIG_IDS.RUNNER)?.poseInterpolation?.loopFrames ?? 24;
  let accumulatedPoseClock = 0;

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const startFrame = shot.frameRange.startFrameInclusive;
    const lastFrame = Math.max(startFrame, shot.frameRange.endFrameExclusive - 1);
    const shotDurationFrames = Math.max(1, shot.frameRange.endFrameExclusive - startFrame);
    const midFrame = Math.floor((startFrame + lastFrame) / 2);

    const startX = runnerWaypointsX[Math.min(i, runnerWaypointsX.length - 2)];
    const endX = runnerWaypointsX[Math.min(i + 1, runnerWaypointsX.length - 1)];
    const frameSpan = Math.max(1, lastFrame - startFrame);
    const speedPerFrame = (endX - startX) / frameSpan;
    // Base stride speed is ~2.44 world units/frame at timeScale 1.15
    const strideTimeScale = Number(
      Math.max(0.35, Math.min(2.5, (speedPerFrame / 2.44) * 1.15)).toFixed(2)
    );
    const shotPoseStart = Number(
      (((accumulatedPoseClock % runnerLoopFrames) + runnerLoopFrames) % runnerLoopFrames).toFixed(4)
    );
    accumulatedPoseClock += shotDurationFrames * strideTimeScale;

    for (const rigId of shot.activeRigIds) {
      if (rigId === CANONICAL_RIG_IDS.SKYLINE) {
        tracks.push({
          shotId: shot.id,
          rigId,
          transform: {
            keyframes: [
              {
                frame: startFrame,
                position: [0, 200, -900],
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
      } else if (rigId === CANONICAL_RIG_IDS.FACTORIES) {
        tracks.push({
          shotId: shot.id,
          rigId,
          transform: {
            keyframes: [
              {
                frame: startFrame,
                position: [0, 150, -400],
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
      } else if (rigId === CANONICAL_RIG_IDS.SMOKE_CHIMNEY) {
        tracks.push({
          shotId: shot.id,
          rigId,
          transform: {
            keyframes: [
              {
                frame: startFrame,
                position: [-150, 220, -380],
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
      } else if (rigId === CANONICAL_RIG_IDS.FG_PIPES) {
        const pipeKeyframes =
          i === 0
            ? [
                {
                  frame: startFrame,
                  position: [0, 0, 320] as [number, number, number],
                  rotationZDegrees: 0,
                  scale: [1, 1] as [number, number],
                  opacity: 0.92,
                  easing: 'linear' as const
                }
              ]
            : i === 1 && lastFrame > startFrame
              ? [
                  {
                    frame: startFrame,
                    position: [130, 0, 220] as [number, number, number],
                    rotationZDegrees: 0,
                    scale: [1, 1] as [number, number],
                    opacity: 0.92,
                    easing: 'linear' as const
                  },
                  {
                    frame: lastFrame,
                    position: [60, 0, 220] as [number, number, number],
                    rotationZDegrees: 0,
                    scale: [1, 1] as [number, number],
                    opacity: 0.85,
                    easing: 'linear' as const
                  }
                ]
              : lastFrame > startFrame
                ? [
                    {
                      frame: startFrame,
                      position: [60, 0, 220] as [number, number, number],
                      rotationZDegrees: 0,
                      scale: [1, 1] as [number, number],
                      opacity: 0.85,
                      easing: 'easeOutQuad' as const
                    },
                    {
                      frame: lastFrame,
                      position: [-260, 0, 240] as [number, number, number],
                      rotationZDegrees: 0,
                      scale: [1, 1] as [number, number],
                      opacity: 0,
                      easing: 'linear' as const
                    }
                  ]
                : [
                    {
                      frame: startFrame,
                      position: [-260, 0, 240] as [number, number, number],
                      rotationZDegrees: 0,
                      scale: [1, 1] as [number, number],
                      opacity: 0,
                      easing: 'linear' as const
                    }
                  ];

        tracks.push({
          shotId: shot.id,
          rigId,
          transform: {
            keyframes: pipeKeyframes
          },
          morphKeyframes: {},
          morphBindings: []
        });
      } else if (rigId === CANONICAL_RIG_IDS.RUNNER_AURA) {
        const auraKeyframes =
          lastFrame > startFrame
            ? [
                {
                  frame: startFrame,
                  position: [startX - 14, 98, -10] as [number, number, number],
                  rotationZDegrees: 0,
                  scale: [1, 1] as [number, number],
                  opacity: 0.85,
                  easing: 'linear' as const
                },
                {
                  frame: lastFrame,
                  position: [endX - 14, 98, -10] as [number, number, number],
                  rotationZDegrees: 0,
                  scale: [1, 1] as [number, number],
                  opacity: 0.85,
                  easing: 'linear' as const
                }
              ]
            : [
                {
                  frame: startFrame,
                  position: [startX - 14, 98, -10] as [number, number, number],
                  rotationZDegrees: 0,
                  scale: [1, 1] as [number, number],
                  opacity: 0.85,
                  easing: 'linear' as const
                }
              ];

        tracks.push({
          shotId: shot.id,
          rigId,
          transform: {
            keyframes: auraKeyframes
          },
          morphKeyframes: {},
          morphBindings: []
        });
      } else if (rigId === CANONICAL_RIG_IDS.RUNNER) {
        const isCloseUp = shot.framing === 'CLOSE_UP';
        const runnerKeyframes =
          lastFrame > startFrame
            ? [
                {
                  frame: startFrame,
                  position: [startX, 95, 0] as [number, number, number],
                  rotationZDegrees: 0,
                  scale: [1, 1] as [number, number],
                  opacity: 1,
                  easing: isCloseUp ? ('easeOutQuad' as const) : ('linear' as const)
                },
                {
                  frame: lastFrame,
                  position: [endX, 95, 0] as [number, number, number],
                  rotationZDegrees: 0,
                  scale: [1, 1] as [number, number],
                  opacity: 1,
                  easing: 'linear' as const
                }
              ]
            : [
                {
                  frame: startFrame,
                  position: [startX, 95, 0] as [number, number, number],
                  rotationZDegrees: 0,
                  scale: [1, 1] as [number, number],
                  opacity: 1,
                  easing: 'linear' as const
                }
              ];

        const morphKeyframes: EntityTrack['morphKeyframes'] = {};
        if (isCloseUp && lastFrame > startFrame + 6) {
          const blinkStart = Math.max(startFrame + 1, midFrame - 3);
          const blinkMid = Math.min(lastFrame - 1, midFrame);
          const blinkEnd = Math.min(lastFrame, midFrame + 3);
          morphKeyframes.browRaise = [
            { frame: startFrame, weight: 0.15 },
            { frame: midFrame, weight: 0.45 },
            { frame: lastFrame, weight: 0.35 }
          ];
          if (blinkStart < blinkMid && blinkMid < blinkEnd) {
            morphKeyframes.blink = [
              { frame: startFrame, weight: 0 },
              { frame: blinkStart, weight: 0 },
              { frame: blinkMid, weight: 1 },
              { frame: blinkEnd, weight: 0 }
            ];
          }
        } else if (lastFrame > startFrame) {
          morphKeyframes.browRaise = [
            { frame: startFrame, weight: 0.1 },
            { frame: lastFrame, weight: 0.3 }
          ];
        }

        tracks.push({
          shotId: shot.id,
          rigId,
          transform: {
            keyframes: runnerKeyframes
          },
          pose: {
            timeScale: strideTimeScale,
            startPoseFrame: shotPoseStart
          },
          morphKeyframes,
          morphBindings: [
            {
              target: 'mouthOpen',
              source: 'audio.rms',
              gain: isCloseUp ? 0.65 : 0.5,
              bias: 0.02,
              spring: { zeta: 0.45, omega: 22 }
            },
            {
              target: 'browRaise',
              source: 'audio.onsetStrength',
              gain: 0.25,
              bias: 0.05,
              spring: { zeta: 0.5, omega: 18 }
            }
          ]
        });
      } else {
        const rig = input.rigs.get(rigId);
        const defaultPos: [number, number, number] = rig
          ? [
              rig.baseTransform.position[0],
              rig.baseTransform.position[1],
              rig.baseTransform.position[2]
            ]
          : [0, 0, -100];
        tracks.push({
          shotId: shot.id,
          rigId,
          transform: {
            keyframes: [
              {
                frame: startFrame,
                position: defaultPos,
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
    projectId: input.storyboard.projectId,
    tracks
  };
}

/**
 * Choreographer Agent: Synthesizes the ChoreographyContract binding storyboard shots,
 * asset rigs, stride-matched character motion, and audio-reactive facial morphs.
 */
export class ChoreographerAgent {
  private readonly provider: LlmProvider;

  constructor(provider: LlmProvider) {
    this.provider = provider;
  }

  public buildSystemPrompt(): string {
    return [
      'You are the Principal Choreographer Agent for an AI 2.5D Animation Studio.',
      'Your task is to generate a strictly valid JSON object conforming to ChoreographyContractSchema.',
      'Invariants to enforce:',
      '1. Every (shotId, rigId) pair in tracks must be unique and reference an existing shotId and a rigId declared in that shot activeRigIds.',
      '2. Transform and morph keyframes must have strictly ascending frame numbers within [shot.startFrameInclusive, shot.endFrameExclusive).',
      '3. For characters with facingDirection ("right" or "left"), horizontal translation dx MUST match the facing direction (dx >= 0 for "right", dx <= 0 for "left") to prevent moonwalking.',
      '4. Synchronize pose.timeScale with horizontal translation velocity.',
      '5. Keep world positions of stationary environment rigs ("rig-skyline", "rig-factories", "rig-smoke-chimney") constant across shot cuts.',
      'Return ONLY valid JSON.'
    ].join('\n');
  }

  public buildUserPrompt(input: ChoreographerAgentInput): string {
    const shotSummaries = input.storyboard.shots.map((s) => ({
      id: s.id,
      framing: s.framing,
      movement: s.movement,
      frameRange: s.frameRange,
      activeRigIds: s.activeRigIds
    }));

    const rigSummaries = Array.from(input.rigs.values()).map((r) => ({
      id: r.id,
      type: r.type,
      facingDirection: r.facingDirection,
      basePosition: r.baseTransform.position,
      morphTargets: r.morphTopology?.targets.map((t) => t.name) ?? []
    }));

    const basePrompt = [
      `Generate a ChoreographyContract for storyboard "${input.storyboard.projectId}".`,
      `Shots: ${JSON.stringify(shotSummaries)}`,
      `Rigs: ${JSON.stringify(rigSummaries)}`
    ].join('\n');

    const repairSection = formatRepairFeedbackPrompt(input.repairErrors ?? []);
    return `${basePrompt}${repairSection}`;
  }

  public async generateChoreography(
    input: ChoreographerAgentInput
  ): Promise<ChoreographyContract> {
    const prompt = this.buildUserPrompt(input);
    return this.provider.generateStructuredJson(prompt, ChoreographyContractSchema, {
      systemPrompt: this.buildSystemPrompt(),
      temperature: 0.1,
      agentRole: 'choreographer',
      attempt: input.attempt ?? 1,
      repairErrors: input.repairErrors ?? [],
      context: {
        choreographerInput: input
      }
    });
  }
}
