import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { SceneCompositor } from '../src/engine/compositor/scene-compositor.js';
import type { FrameStateContract } from '../src/schemas/frame.contract.js';
import type { AssetRigContract } from '../src/schemas/rig.contract.js';

const createDummyFrameState = (overrides?: Partial<FrameStateContract>): FrameStateContract => ({
  frameIndex: 0,
  timeSeconds: 0,
  shotId: 'test_shot',
  camera: {
    position: [0, 50, 200],
    target: [0, 50, 0],
    up: [0, 1, 0],
    verticalFovDegrees: 45,
    nearPlane: 1,
    farPlane: 1000,
    rollDegrees: 0,
    projectionMode: 'perspective'
  },
  palette: {
    background: '#090b16',
    primary: '#00f0ff',
    secondary: '#3a506b',
    accent: '#ff0055',
    ambientLightColor: '#1a243b',
    ambientIntensity: 0.72,
    keyLightDirection: [-0.5, -0.8, -0.3],
    audioReactiveGain: 0.65
  },
  audio: {
    frameIndex: 0,
    timestamp: 0,
    rms: 0,
    rmsRelativeGlobal: 0,
    rmsRelativeLocal: 0,
    localWindowFrames: 30,
    spectralFlux: 0,
    onsetStrength: 0,
    isOnset: false,
    bands: { subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, presence: 0, brilliance: 0 }
  },
  lyric: null,
  entities: [],
  ...overrides
});

test('D5: Declarative weather contract and AST hygiene suite', async (t) => {
  const compositor = new SceneCompositor({ width: 1920, height: 1080 });
  const dummyRigs = new Map<string, AssetRigContract>();

  await t.test('D5.1: Weather renders only when declared in precipitation contract', () => {
    // When precipitation is undefined or kind is 'none', zero rain lines are emitted
    const stateNoPrecip = createDummyFrameState({
      shotId: 'exterior_vista',
      precipitation: { kind: 'none', density: 0, slant: 0, speed: 0 }
    });

    compositor.renderFrame(stateNoPrecip, dummyRigs);
    const rainLinesNoPrecip = (compositor.getLastDrawOrder() ?? []).filter(
      (d) => d.kind === 'env_line'
    );
    assert.equal(
      rainLinesNoPrecip.length,
      0,
      'When precipitation is none, zero rain lines must be drawn even if shotId contains exterior'
    );
  });

  await t.test('D5.2: An indoor set holding an umbrella prop shows no rain', () => {
    // Indoor shot with an umbrella entity present
    const stateIndoorWithUmbrella = createDummyFrameState({
      shotId: 'interior_room',
      entities: [
        {
          rigId: 'umbrella',
          worldPosition: [0, 50, 0],
          worldRotationZDegrees: 0,
          scale: [1, 1],
          jointAngles: {},
          jointOffsets: {},
          morphWeights: {},
          opacity: 1.0
        }
      ],
      precipitation: { kind: 'none', density: 0, slant: 0, speed: 0 }
    });

    compositor.renderFrame(stateIndoorWithUmbrella, dummyRigs);
    const rainLines = (compositor.getLastDrawOrder() ?? []).filter(
      (d) => d.kind === 'env_line'
    );
    assert.equal(
      rainLines.length,
      0,
      'Indoor set with an umbrella must NOT render rain when precipitation is none'
    );
  });

  await t.test('D5.3: An outdoor set without any umbrella shows rain when declared', () => {
    // Outdoor shot declaring precipitation kind 'rain' without any umbrella entity
    const stateRain = createDummyFrameState({
      shotId: 'outdoor_overlook',
      entities: [],
      precipitation: { kind: 'rain', density: 0.8, slant: -5, speed: 11 }
    });

    compositor.renderFrame(stateRain, dummyRigs);
    const rainLines = (compositor.getLastDrawOrder() ?? []).filter(
      (d) => d.kind === 'env_line'
    );
    assert.ok(
      rainLines.length > 0,
      'When precipitation kind is rain, rain streak lines must be rendered'
    );
  });

  await t.test('D5.4: Hygiene scan (TypeScript AST) fails on any comparison of shotId/rigId/set ids against string literals in src/engine/compositor/', () => {
    const compositorDir = path.resolve(process.cwd(), 'src/engine/compositor');
    const files = fs.readdirSync(compositorDir).filter((f) => f.endsWith('.ts'));

    const violations: string[] = [];

    for (const file of files) {
      const fullPath = path.join(compositorDir, file);
      const sourceText = fs.readFileSync(fullPath, 'utf8');
      const sourceFile = ts.createSourceFile(fullPath, sourceText, ts.ScriptTarget.Latest, true);

      function visit(node: ts.Node) {
        // Check for binary expressions: a === 'literal' or a.includes('literal')
        if (ts.isBinaryExpression(node)) {
          const isLeftId =
            (ts.isPropertyAccessExpression(node.left) &&
              (node.left.name.text === 'shotId' ||
                node.left.name.text === 'rigId' ||
                node.left.name.text === 'kitId' ||
                node.left.name.text === 'variantId')) ||
            (ts.isIdentifier(node.left) &&
              (node.left.text === 'shotId' ||
                node.left.text === 'rigId' ||
                node.left.text === 'kitId' ||
                node.left.text === 'variantId'));
          const isRightLiteral = ts.isStringLiteral(node.right);

          if (isLeftId && isRightLiteral) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            violations.push(`${file}:${line + 1}: ${node.getText(sourceFile)}`);
          }
        }

        // Check for method calls: .includes('literal') on shotId or rigId
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const propName = node.expression.name.text;
          const target = node.expression.expression;
          const isTargetId =
            (ts.isPropertyAccessExpression(target) &&
              (target.name.text === 'shotId' || target.name.text === 'rigId')) ||
            (ts.isIdentifier(target) && (target.text === 'shotId' || target.text === 'rigId'));

          if (
            isTargetId &&
            (propName === 'includes' || propName === 'startsWith' || propName === 'endsWith')
          ) {
            const arg = node.arguments[0];
            if (arg && ts.isStringLiteral(arg)) {
              const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
              violations.push(`${file}:${line + 1}: ${node.getText(sourceFile)}`);
            }
          }
        }

        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
    }

    if (violations.length > 0) {
      console.log(`[D5.4 Reproduction] Hardcoded shotId/rigId checks in src/engine/compositor/:`);
      for (const v of violations) {
        console.log(`  - ${v}`);
      }
    }

    assert.equal(
      violations.length,
      0,
      `Forbidden string literal comparisons against shotId/rigId in src/engine/compositor/ (found ${violations.length} violations)`
    );
  });
});
