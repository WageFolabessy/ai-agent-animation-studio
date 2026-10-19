import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../src/config/paths.js';

interface ForbiddenTermsFixture {
  _description: string;
  terms: string[];
}

export interface TermViolation {
  file: string;
  line: number;
  term: string;
  snippet: string;
}

const FIXTURE_RELATIVE_PATH = path.join('tests', 'fixtures', 'english-policy-forbidden-terms.json');
const FIXTURE_ABSOLUTE_PATH = path.join(PROJECT_ROOT, FIXTURE_RELATIVE_PATH);

function loadForbiddenTerms(): string[] {
  const raw = fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8');
  const data = JSON.parse(raw) as ForbiddenTermsFixture;
  return data.terms;
}

/**
 * Directories excluded from source scanning:
 * - node_modules: external third-party dependencies
 * - .git: version control metadata
 * - .gemini: IDE runtime metadata
 * - output: generated binary video outputs
 */
const EXCLUDED_DIRECTORY_NAMES = new Set(['node_modules', '.git', '.gemini', 'output']);

/**
 * Text file extensions scanned for language compliance.
 */
const SCANNED_EXTENSIONS = new Set(['.ts', '.js', '.json', '.md', '.py', '.txt']);

export function scanFileForForbiddenTerms(filePath: string, terms: string[]): TermViolation[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const violations: TermViolation[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineText = lines[lineIndex];
    const lower = lineText.toLowerCase();

    for (const term of terms) {
      const regex = new RegExp(`\\b${term}\\b`, 'i');
      if (regex.test(lower)) {
        violations.push({
          file: path.relative(PROJECT_ROOT, filePath),
          line: lineIndex + 1,
          term,
          snippet: lineText.trim()
        });
      }
    }
  }

  return violations;
}

export function collectScannableProjectFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
        collectScannableProjectFiles(fullPath, fileList);
      }
    } else if (entry.isFile()) {
      // The forbidden-terms fixture is intentionally excluded as it stores the prohibited vocabulary
      if (path.resolve(fullPath) === FIXTURE_ABSOLUTE_PATH) {
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (SCANNED_EXTENSIONS.has(ext)) {
        fileList.push(fullPath);
      }
    }
  }

  return fileList;
}

test('English-Only Policy: No forbidden non-English terms remain across project source and documentation', () => {
  const forbiddenTerms = loadForbiddenTerms();
  const projectFiles = collectScannableProjectFiles(PROJECT_ROOT);

  assert.ok(projectFiles.length > 20, 'Expected at least 20 project files to be scanned');

  const allViolations: TermViolation[] = [];
  for (const file of projectFiles) {
    const violations = scanFileForForbiddenTerms(file, forbiddenTerms);
    allViolations.push(...violations);
  }

  if (allViolations.length > 0) {
    const report = allViolations
      .map((v) => `  [${v.file}:${v.line}] term "${v.term}": ${v.snippet}`)
      .join('\n');
    assert.fail(`Non-English language terms detected in project files:\n${report}`);
  }
});

test('English-Only Policy: Successfully detects forbidden term violations with file and line context', () => {
  const forbiddenTerms = loadForbiddenTerms();
  const sampleForbiddenTerm = forbiddenTerms[0];

  const tempFilePath = path.join(PROJECT_ROOT, 'tests', 'fixtures', 'temp-test-sample.txt');
  try {
    fs.writeFileSync(
      tempFilePath,
      `Line 1 is clear english\nLine 2 contains a violation: ${sampleForbiddenTerm}\nLine 3 is clear`
    );

    const violations = scanFileForForbiddenTerms(tempFilePath, forbiddenTerms);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 2);
    assert.equal(violations[0].term, sampleForbiddenTerm);
    assert.ok(violations[0].snippet.includes('Line 2 contains a violation'));
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
});
