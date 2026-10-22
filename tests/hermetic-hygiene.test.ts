import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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

test('Hermetic Test Isolation: AST verification of zero repo-root output/ or assets/ access across test suite', () => {
  const testsDir = path.resolve(process.cwd(), 'tests');
  const testFiles = getTestFiles(testsDir);

  assert.ok(testFiles.length >= 10, `Expected at least 10 test files to scan, found ${testFiles.length}`);

  const violations: Array<{ file: string; line: number; message: string }> = [];

  for (const file of testFiles) {
    const code = fs.readFileSync(file, 'utf-8');
    const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
    const relFile = path.relative(process.cwd(), file);

    function checkNode(node: ts.Node) {
      // 1. Check imports
      if (ts.isImportDeclaration(node)) {
        const specifier = node.moduleSpecifier;
        if (ts.isStringLiteral(specifier)) {
          const modText = specifier.text;
          if (modText.includes('output') || (modText.includes('assets') && !modText.includes('optional-asset'))) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            violations.push({
              file: relFile,
              line: line + 1,
              message: `Forbidden module import: "${modText}"`
            });
          }
        }
      }

      // 2. Check path.join or path.resolve calls referencing repo-root 'output' or 'assets'
      if (ts.isCallExpression(node)) {
        const callExpr = node.expression;
        if (ts.isPropertyAccessExpression(callExpr)) {
          const fnName = callExpr.name.text;
          if (fnName === 'join' || fnName === 'resolve') {
            const args = node.arguments;
            for (const arg of args) {
              if (ts.isStringLiteral(arg)) {
                const text = arg.text;
                if (text === 'output' || text === 'assets') {
                  const { line } = sourceFile.getLineAndCharacterOfPosition(arg.getStart());
                  violations.push({
                    file: relFile,
                    line: line + 1,
                    message: `Forbidden path.${fnName} argument: "${text}"`
                  });
                }
              }
            }
          }
        }
      }

      // 3. Check raw string literals referencing output/ or assets/ directories
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const text = node.text;
        // Flag literal directory paths to output/ or assets/
        if (
          text.startsWith('output/') ||
          text.startsWith('assets/') ||
          text.includes('/output/') ||
          text.includes('/assets/')
        ) {
          // Exempt harmless MIME types or docstrings if any
          if (!text.includes('image/') && !text.includes('video/')) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            violations.push({
              file: relFile,
              line: line + 1,
              message: `Forbidden literal path reference: "${text}"`
            });
          }
        }
      }

      ts.forEachChild(node, checkNode);
    }

    checkNode(sourceFile);
  }

  assert.equal(
    violations.length,
    0,
    `Hermetic AST hygiene violation! Found ${violations.length} forbidden references:\n` +
      violations.map((v) => `  ${v.file}:${v.line} -> ${v.message}`).join('\n')
  );
});
