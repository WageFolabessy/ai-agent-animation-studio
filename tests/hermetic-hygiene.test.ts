import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function getTestFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'helpers' && entry.name !== 'node_modules') {
        results.push(...getTestFiles(fullPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.test.ts') && entry.name !== 'hermetic-hygiene.test.ts') {
      results.push(fullPath);
    }
  }
  return results;
}

test('Hermetic Test Isolation & Asset Guards: Zero test files contain literal output/ or assets/audio/ paths', () => {
  const testsDir = path.resolve(process.cwd(), 'tests');
  const testFiles = getTestFiles(testsDir);

  assert.ok(testFiles.length >= 10, `Expected at least 10 test files to scan, found ${testFiles.length}`);

  const violations: Array<{ file: string; line: number; text: string }> = [];

  for (const file of testFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    lines.forEach((lineText, idx) => {
      if (lineText.includes('output/') || lineText.includes('assets/audio/')) {
        violations.push({
          file: path.relative(process.cwd(), file),
          line: idx + 1,
          text: lineText.trim()
        });
      }
    });
  }

  assert.equal(
    violations.length,
    0,
    `Hermetic test violation! Found ${violations.length} forbidden literal references:\n` +
      violations.map((v) => `  ${v.file}:${v.line} -> ${v.text}`).join('\n')
  );
});
