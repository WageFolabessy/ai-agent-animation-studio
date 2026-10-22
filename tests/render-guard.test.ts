import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE_RENDER_VERSION, computeRenderSourcesHash } from '../src/config/render-version.js';

test('Engine Render Version & Sources Hash Guard', async (t) => {
  await t.test('Current render sources match recorded render-sources-hash.txt', () => {
    const hashFile = path.join(process.cwd(), 'src', 'config', 'render-sources-hash.txt');
    assert.ok(fs.existsSync(hashFile), 'src/config/render-sources-hash.txt must exist');

    const expectedHash = fs.readFileSync(hashFile, 'utf8').trim();
    const actualHash = computeRenderSourcesHash();

    assert.equal(
      actualHash,
      expectedHash,
      `Render-affecting sources (src/engine, src/schemas) have changed! If you intentionally updated render logic or math, update src/config/render-sources-hash.txt and bump ENGINE_RENDER_VERSION (currently ${ENGINE_RENDER_VERSION}).`
    );
  });

  await t.test('ENGINE_RENDER_VERSION is bumped to at least 2', () => {
    assert.ok(
      ENGINE_RENDER_VERSION >= 2,
      `ENGINE_RENDER_VERSION must be >= 2 (found: ${ENGINE_RENDER_VERSION})`
    );
  });

  await t.test('Sources hash is deterministic and sensitive to file content changes', () => {
    const h1 = computeRenderSourcesHash();
    const h2 = computeRenderSourcesHash();
    assert.equal(h1, h2, 'Hash must be strictly deterministic across calls');
    assert.match(h1, /^[0-9a-f]{64}$/, 'Hash must be a 64-character lowercase hex string');
  });
});
