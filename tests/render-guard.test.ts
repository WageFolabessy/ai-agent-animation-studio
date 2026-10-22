import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ENGINE_RENDER_VERSION,
  RENDER_AFFECTING_SRC_DIRS,
  EXEMPT_SRC_DIRS,
  computeRenderSourcesHash
} from '../src/config/render-version.js';

test('Engine Render Version & Sources Hash Guard', async (t) => {
  await t.test('Current render sources match recorded render-sources-hash.txt', () => {
    const hashFile = path.join(process.cwd(), 'src', 'config', 'render-sources-hash.txt');
    assert.ok(fs.existsSync(hashFile), 'src/config/render-sources-hash.txt must exist');

    const expectedHash = fs.readFileSync(hashFile, 'utf8').trim();
    const actualHash = computeRenderSourcesHash();

    assert.equal(
      actualHash,
      expectedHash,
      `Render-affecting sources (${RENDER_AFFECTING_SRC_DIRS.map((d) => `src/${d}`).join(', ')}) have changed! ` +
        `If you intentionally updated render logic or math, update src/config/render-sources-hash.txt and bump ENGINE_RENDER_VERSION (currently ${ENGINE_RENDER_VERSION}).`
    );
  });

  await t.test('ENGINE_RENDER_VERSION is bumped to at least 4', () => {
    assert.ok(
      ENGINE_RENDER_VERSION >= 4,
      `ENGINE_RENDER_VERSION must be >= 4 (found: ${ENGINE_RENDER_VERSION})`
    );
  });

  await t.test(
    'Every top-level directory under src/ is explicitly classified as hashed or exempt',
    () => {
      const srcDir = path.join(process.cwd(), 'src');
      const entries = fs.readdirSync(srcDir, { withFileTypes: true });
      const actualDirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();

      const hashedSet = new Set<string>(RENDER_AFFECTING_SRC_DIRS);
      const exemptSet = new Set<string>(EXEMPT_SRC_DIRS);

      for (const dir of RENDER_AFFECTING_SRC_DIRS) {
        assert.ok(
          !exemptSet.has(dir),
          `Directory src/${dir} cannot be in both RENDER_AFFECTING_SRC_DIRS and EXEMPT_SRC_DIRS`
        );
      }

      for (const dir of actualDirs) {
        assert.ok(
          hashedSet.has(dir) || exemptSet.has(dir),
          `Unclassified top-level directory src/${dir}: must be added to RENDER_AFFECTING_SRC_DIRS or EXEMPT_SRC_DIRS in src/config/render-version.ts`
        );
      }
    }
  );

  await t.test(
    'Sources hash is deterministic and sensitive to mutations across engine, schemas, renderer, and config',
    () => {
      const h1 = computeRenderSourcesHash();
      const h2 = computeRenderSourcesHash();
      assert.equal(h1, h2, 'Hash must be strictly deterministic across calls');
      assert.match(h1, /^[0-9a-f]{64}$/, 'Hash must be a 64-character lowercase hex string');

      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-render-hash-test-'));
      try {
        for (const dir of RENDER_AFFECTING_SRC_DIRS) {
          const targetDir = path.join(tmpRoot, 'src', dir);
          fs.mkdirSync(targetDir, { recursive: true });
          fs.writeFileSync(path.join(targetDir, 'sample.ts'), `export const v_${dir} = 1;\n`);
        }

        const baseTmpHash = computeRenderSourcesHash(tmpRoot);

        for (const dir of RENDER_AFFECTING_SRC_DIRS) {
          const file = path.join(tmpRoot, 'src', dir, 'sample.ts');
          const orig = fs.readFileSync(file, 'utf8');
          fs.writeFileSync(file, `${orig}// mutated ${dir}\n`);
          const mutatedHash = computeRenderSourcesHash(tmpRoot);
          assert.notEqual(
            mutatedHash,
            baseTmpHash,
            `computeRenderSourcesHash must change when a .ts file in src/${dir} is modified`
          );
          fs.writeFileSync(file, orig);
          assert.equal(computeRenderSourcesHash(tmpRoot), baseTmpHash);
        }
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    }
  );
});
