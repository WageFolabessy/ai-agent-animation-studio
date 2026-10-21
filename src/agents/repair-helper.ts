import type { ValidationErrorItem } from '../schemas/invariants.js';

export interface TargetedRepairContext {
  readonly path: string;
  readonly subtree: unknown;
}

/**
 * Parses path tokens from paths like "shots[2].camera.fov" or "rigs.cyber_runner.parts".
 */
export function parsePathTokens(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((seg) => seg.trim().length > 0);
}

/**
 * Traverses a parsed JSON object and extracts the parent or immediate subtree for a path.
 */
export function extractSubtreeAtPath(
  data: unknown,
  path: string
): { path: string; subtree: unknown } | undefined {
  if (data === null || typeof data !== 'object') return undefined;
  const tokens = parsePathTokens(path);
  if (tokens.length === 0) return undefined;

  // Walk up to 1 level before leaf if path has multiple levels, so we have meaningful context
  const targetDepth = tokens.length > 1 ? tokens.length - 1 : 1;
  let curr: any = data;
  const breadcrumb: string[] = [];

  for (let i = 0; i < targetDepth; i++) {
    const key = tokens[i];
    if (curr === null || typeof curr !== 'object' || !(key in curr)) {
      break;
    }
    curr = curr[key];
    breadcrumb.push(key);
  }

  if (breadcrumb.length === 0 || curr === undefined) return undefined;

  const displayPath = breadcrumb
    .map((seg) => (/^\d+$/.test(seg) ? `[${seg}]` : seg))
    .join('.')
    .replace(/\.\[/g, '[');

  return { path: displayPath, subtree: curr };
}

/**
 * Formats validation errors and previous failed drafts into a structured,
 * targeted self-healing repair prompt section.
 * Enforces strict token/character bounds (< 2,000 tokens) and never truncates mid-JSON silently.
 */
export function formatRepairFeedbackPrompt(
  errors: readonly ValidationErrorItem[],
  previousDraft?: string
): string {
  if (errors.length === 0 && (!previousDraft || previousDraft.trim().length === 0)) {
    return '';
  }

  // 1. Truncation error: do not send truncated draft back!
  if (errors.some((e) => e.code === 'LLM_OUTPUT_TRUNCATED')) {
    return [
      '',
      '[SELF-HEALING REPAIR DIAGNOSTICS]',
      'Your previous response was truncated because it exceeded the maximum token limit (finish_reason: "length").',
      'Please produce a more compact JSON response: reduce redundant keyframe arrays, eliminate unnecessary narrative prose, and return ONLY valid JSON.'
    ].join('\n');
  }

  const parts: string[] = [''];

  // 2. Format previous draft context if available
  if (previousDraft && previousDraft.trim().length > 0) {
    const trimmed = previousDraft.trim();
    parts.push('[PREVIOUS FAILED JSON DRAFT]');

    if (trimmed.length <= 12_000) {
      // Draft fits within the maximum allowable single-prompt context budget
      parts.push('```json', trimmed, '```', '');
    } else {
      // Large draft (> 12,000 chars, e.g. multi-minute choreography/rigs):
      // Extract targeted offending subtrees rather than blindly slicing mid-JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // Fall through
      }

      if (parsed !== undefined && typeof parsed === 'object' && parsed !== null) {
        const uniqueSubtrees = new Map<string, unknown>();
        for (const err of errors) {
          const res = extractSubtreeAtPath(parsed, err.path);
          if (res && !uniqueSubtrees.has(res.path)) {
            uniqueSubtrees.set(res.path, res.subtree);
          }
        }

        if (uniqueSubtrees.size > 0) {
          parts.push(
            'Targeted offending subtrees extracted from previous draft (full payload omitted for token budget):'
          );
          let totalChars = 0;
          for (const [subPath, subtree] of uniqueSubtrees.entries()) {
            const serialized = JSON.stringify(subtree, null, 2);
            const cleanSub =
              serialized.length > 2000
                ? `${serialized.slice(0, 2000)}\n  ... [subtree truncated for budget]`
                : serialized;
            if (totalChars + cleanSub.length < 6000) {
              parts.push(`Subtree at path "${subPath}":`, '```json', cleanSub, '```');
              totalChars += cleanSub.length;
            }
          }
          parts.push('');
        } else {
          parts.push(
            '```json',
            `${trimmed.slice(0, 4000)}\n... [remainder omitted for token budget]`,
            '```',
            ''
          );
        }
      } else {
        parts.push(
          '```',
          `${trimmed.slice(0, 3000)}\n... [remainder omitted for token budget]`,
          '```',
          ''
        );
      }
    }
  }

  // 3. Format error diagnostics
  if (errors.length > 0) {
    const lines = errors.map(
      (err, idx) =>
        `  ${idx + 1}. [${err.severity.toUpperCase()}] ${err.code} at "${err.path}": ${err.message}`
    );
    parts.push(
      '[SELF-HEALING REPAIR DIAGNOSTICS]',
      'Your previous JSON output failed contract invariant validation with the following errors:',
      ...lines,
      'Please fix all reported errors while preserving all valid fields and return ONLY valid JSON.'
    );
  }

  return parts.join('\n');
}
