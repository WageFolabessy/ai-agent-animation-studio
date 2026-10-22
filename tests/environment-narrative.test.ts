import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRooftopEnvironment,
  buildHighwayEnvironment,
  buildBridgeEnvironment,
  buildReactorTunnelEnvironment,
  getOrchestratedEnvironment,
  THEMATIC_PALETTES
} from '../src/engine/director/environment-generator.js';

test('EnvironmentNarrative: Generates valid 3D geometry across all 4 visual zones within drawable budgets', () => {
  const palette = THEMATIC_PALETTES.CYBERPUNK_CYAN;

  // 1. Rooftop Zone
  const rooftop = buildRooftopEnvironment(1000, palette);
  assert.ok(rooftop.polygons && rooftop.polygons.length >= 3, 'Expected rooftop floor and HVAC polygons');
  assert.ok(rooftop.lines && rooftop.lines.length >= 5, 'Expected parapet and stanchion lines');
  const rooftopDrawables = (rooftop.polygons?.length ?? 0) + (rooftop.lines?.length ?? 0);
  assert.ok(rooftopDrawables < 40, `Rooftop drawables (${rooftopDrawables}) exceeds 40`);

  // 2. Highway Zone
  const highway = buildHighwayEnvironment(1000, palette);
  assert.ok(highway.polygons && highway.polygons.length >= 2, 'Expected road floor and Jersey barrier polygons');
  assert.ok(highway.lines && highway.lines.length >= 10, 'Expected lane dashes and truss lines');
  const highwayDrawables = (highway.polygons?.length ?? 0) + (highway.lines?.length ?? 0);
  assert.ok(highwayDrawables < 45, `Highway drawables (${highwayDrawables}) exceeds 45`);

  // 3. Bridge Zone
  const bridge = buildBridgeEnvironment(1000, palette);
  assert.ok(bridge.polygons && bridge.polygons.length >= 1, 'Expected bridge deck polygon');
  assert.ok(bridge.lines && bridge.lines.length >= 8, 'Expected suspension cables and pylon lines');
  const bridgeDrawables = (bridge.polygons?.length ?? 0) + (bridge.lines?.length ?? 0);
  assert.ok(bridgeDrawables < 40, `Bridge drawables (${bridgeDrawables}) exceeds 40`);

  // 4. Reactor Zone
  const reactor = buildReactorTunnelEnvironment(1000, palette);
  assert.ok(reactor.polygons && reactor.polygons.length >= 1, 'Expected catwalk polygon');
  assert.ok(reactor.lines && reactor.lines.length >= 20, 'Expected tunnel portal arch ribs');
  const reactorDrawables = (reactor.polygons?.length ?? 0) + (reactor.lines?.length ?? 0);
  assert.ok(reactorDrawables < 45, `Reactor drawables (${reactorDrawables}) exceeds 45`);
});

test('EnvironmentNarrative: getOrchestratedEnvironment dispatches correct zone environments and close-up optimization', () => {
  // Close-up shot 3 retains low-drawable ground grid
  const closeUpEnv = getOrchestratedEnvironment('shot-3', 0, 'ROOFTOP');
  assert.equal(closeUpEnv.polygons?.length, 1);
  assert.equal(closeUpEnv.lines?.length, 2);

  // Standard zone dispatches
  const rooftop = getOrchestratedEnvironment('shot-0', 100, 'ROOFTOP');
  assert.ok((rooftop.polygons?.length ?? 0) >= 3);

  const highway = getOrchestratedEnvironment('shot-1', 500, 'HIGHWAY');
  assert.ok((highway.polygons?.length ?? 0) >= 2);

  const bridge = getOrchestratedEnvironment('shot-2', 1200, 'BRIDGE');
  assert.ok((bridge.polygons?.length ?? 0) >= 1);

  const reactor = getOrchestratedEnvironment('shot-4', 2000, 'REACTOR');
  assert.ok((reactor.lines?.length ?? 0) >= 20);
});
