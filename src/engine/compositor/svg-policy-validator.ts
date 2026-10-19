export interface PolicyViolation {
  rule: string;
  match: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: PolicyViolation[];
}

interface PolicyRule {
  readonly name: string;
  /** Returns the offending markup fragment, or `null` when the rule is satisfied. */
  readonly find: (svgMarkup: string) => string | null;
}

function firstMatch(regex: RegExp): (svgMarkup: string) => string | null {
  return (svgMarkup) => regex.exec(svgMarkup)?.[0] ?? null;
}

/**
 * Finds `url(...)` references that do not point to a local fragment (`url(#id)`).
 * A regex lookahead cannot express this reliably because of whitespace backtracking,
 * so each reference is inspected explicitly.
 */
function findNonLocalUrlReference(svgMarkup: string): string | null {
  for (const match of svgMarkup.matchAll(/url\(\s*(["']?)\s*([^)]*)/gi)) {
    if (!match[2].startsWith('#')) {
      return match[0];
    }
  }
  return null;
}

/**
 * Rules applied to every SVG before it reaches the rasterizer. The rasterizer never
 * performs network or file access for SVG content, but the policy keeps untrusted
 * markup from ever relying on that behavior:
 * - executable content (`<script>`, `<foreignObject>`, embedded documents, `<style>`);
 * - event-handler attributes (`onload=`, `onclick=`, ...);
 * - any reference that is not a local fragment (`href`, `xlink:href`, `url(...)`),
 *   which covers http(s), protocol-relative, `data:`, `file:` and `javascript:` URLs;
 * - DOCTYPE/ENTITY declarations (XML entity expansion).
 *
 * The event-handler rule scans the whole markup (not only tags) on purpose: it can
 * reject text such as `on=`, but a tag-only regex is bypassable through `>` inside
 * attribute values.
 */
const POLICY_RULES: readonly PolicyRule[] = [
  {
    name: 'FORBIDDEN_TAG',
    find: firstMatch(/<\s*(?:script|foreignObject|iframe|embed|object|image|style)\b/i)
  },
  {
    name: 'EVENT_HANDLER_DETECTED',
    find: firstMatch(/\bon[a-zA-Z]+\s*=/i)
  },
  {
    name: 'EXTERNAL_RESOURCE_URL',
    find: (svgMarkup) =>
      firstMatch(/\b(?:xlink:)?href\s*=\s*(?:"\s*(?!#)|'\s*(?!#))/i)(svgMarkup) ??
      findNonLocalUrlReference(svgMarkup)
  },
  {
    name: 'FORBIDDEN_DECLARATION',
    find: firstMatch(/<!\s*(?:DOCTYPE|ENTITY)\b/i)
  }
];

/** Checks SVG markup against the project policy and reports every violated rule. */
export function validateSvgPolicy(svgMarkup: string): ValidationResult {
  const violations: PolicyViolation[] = [];

  for (const rule of POLICY_RULES) {
    const match = rule.find(svgMarkup);
    if (match !== null) {
      violations.push({ rule: rule.name, match });
    }
  }

  return { valid: violations.length === 0, violations };
}

/** Throws a descriptive error when the SVG markup violates the policy. */
export function assertValidSvgPolicy(svgMarkup: string): void {
  const result = validateSvgPolicy(svgMarkup);
  if (!result.valid) {
    const details = result.violations.map((v) => `${v.rule} (${v.match})`).join(', ');
    throw new Error(`SVG policy violation detected: ${details}`);
  }
}
