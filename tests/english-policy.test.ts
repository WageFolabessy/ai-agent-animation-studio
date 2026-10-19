import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../src/config/paths.js';

const FORBIDDEN_WORDS = [
  'harus',
  'ditemukan',
  'diharapkan',
  'berada',
  'di luar',
  'memuat',
  'selesai',
  'memulai',
  'melakukan',
  'sampah',
  'rentang',
  'babak',
  'sendi',
  'tumpang tindih',
  'celah',
  'terdeteksi',
  'memakai',
  'pembatalan',
  'menghasilkan',
  'lingkungan',
  'batasan',
  'mutlak',
  'larangan',
  'ruang lingkup',
  'instruksi',
  'eksekusi',
  'penting',
  'jangan',
  'rancang',
  'struktur',
  'pohon arsitektur'
];

const SCAN_DIRS = ['src', 'scripts', 'tests', 'docs', 'python'];
const ROOT_DOC_FILES = ['README.md', 'package.json', 'tsconfig.json'];

function collectFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== '.gemini' && entry.name !== 'output') {
        collectFiles(fullPath, fileList);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      // Only scan text source/doc files
      if (['.ts', '.js', '.json', '.md', '.py', '.txt'].includes(ext)) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

test('English-Only Policy: No Indonesian language terms remain in project source and documentation', () => {
  const filesToScan: string[] = [];

  for (const dir of SCAN_DIRS) {
    collectFiles(path.join(PROJECT_ROOT, dir), filesToScan);
  }
  for (const rootFile of ROOT_DOC_FILES) {
    const p = path.join(PROJECT_ROOT, rootFile);
    if (fs.existsSync(p)) filesToScan.push(p);
  }

  const violations: Array<{ file: string; line: number; term: string; snippet: string }> = [];

  for (const filePath of filesToScan) {
    // Skip this test file itself so the word dictionary is not self-flagged
    if (filePath.endsWith('english-policy.test.ts')) continue;

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const lineText = lines[lineIndex];
      const lower = lineText.toLowerCase();

      for (const word of FORBIDDEN_WORDS) {
        // Match whole word or exact phrase
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        if (regex.test(lower)) {
          violations.push({
            file: path.relative(PROJECT_ROOT, filePath),
            line: lineIndex + 1,
            term: word,
            snippet: lineText.trim()
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    const report = violations
      .map((v) => `  [${v.file}:${v.line}] term "${v.term}": ${v.snippet}`)
      .join('\n');
    assert.fail(`Non-English (Indonesian) terms detected in project files:\n${report}`);
  }
});
