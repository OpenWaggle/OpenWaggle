/**
 * Weakened TypeScript configs (TS-01): a strict flag turned off, or a change to which files a
 * config checks (`include`, `files`, `exclude`, `extends`). Neither is an agent's call, so the gate
 * asks the user and blocks until they allow it or the change is reverted.
 */
import type { Finding } from './findings'

export const TSCONFIG_FILE = /(?:^|\/)tsconfig[^/]*\.json$/u

/** Flags whose strict value is `true`; the `strict` family defaults to the `strict` setting. */
const STRICT_FAMILY = [
  'noImplicitAny',
  'strictNullChecks',
  'strictFunctionTypes',
  'strictBindCallApply',
  'strictPropertyInitialization',
  'strictBuiltinIteratorReturn',
  'noImplicitThis',
  'useUnknownInCatchVariables',
  'alwaysStrict',
] as const
const STRICT_WHEN_TRUE = [
  'strict',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
  'noImplicitOverride',
  'noImplicitReturns',
  'noFallthroughCasesInSwitch',
  'noPropertyAccessFromIndexSignature',
  'noUnusedLocals',
  'noUnusedParameters',
  'noUncheckedSideEffectImports',
  'erasableSyntaxOnly',
  'verbatimModuleSyntax',
  'isolatedModules',
  'forceConsistentCasingInFileNames',
] as const
const STRICT_WHEN_FALSE = [
  'allowUnreachableCode',
  'allowUnusedLabels',
  'skipLibCheck',
  'allowJs',
] as const
const SCOPE_FIELDS = ['include', 'files', 'exclude', 'extends', 'references'] as const

type Json = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A string, which is kept, or a comment, which is dropped. */
const STRING_OR_COMMENT = /"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//gu
/** A string, kept, or a comma before a closing bracket, dropped. */
const STRING_OR_TRAILING_COMMA = /"(?:[^"\\]|\\.)*"|,(?=\s*[}\]])/gu

/** JSON with comments and trailing commas, as tsconfig files allow. */
export function parseJsonc(text: string): unknown {
  const keepStrings = (match: string) => (match.startsWith('"') ? match : '')
  return JSON.parse(
    text.replace(STRING_OR_COMMENT, keepStrings).replace(STRING_OR_TRAILING_COMMA, keepStrings),
  )
}

function options(config: unknown): Json {
  const compilerOptions = isRecord(config) ? config['compilerOptions'] : undefined
  return isRecord(compilerOptions) ? compilerOptions : {}
}

function weakenedFlags(before: Json, after: Json) {
  const strictBefore = before['strict'] === true
  const strictAfter = after['strict'] === true
  const family = STRICT_FAMILY.filter(
    (flag) => (before[flag] ?? strictBefore) === true && (after[flag] ?? strictAfter) !== true,
  )
  const whenTrue = STRICT_WHEN_TRUE.filter((flag) => before[flag] === true && after[flag] !== true)
  const whenFalse = STRICT_WHEN_FALSE.filter(
    (flag) => before[flag] !== true && after[flag] === true,
  )
  return [...whenTrue, ...family, ...whenFalse]
}

function scopeChanges(before: unknown, after: unknown) {
  return SCOPE_FIELDS.filter((field) => {
    const was = isRecord(before) ? before[field] : undefined
    const now = isRecord(after) ? after[field] : undefined
    return JSON.stringify(was) !== JSON.stringify(now)
  })
}

/** What weakened between two versions of a tsconfig, as one-line descriptions. */
export function tsconfigWeakenings(before: string | undefined, after: string) {
  if (before === undefined) return []
  let was: unknown
  let now: unknown
  try {
    was = parseJsonc(before)
    now = parseJsonc(after)
  } catch {
    return ['no longer parses as JSON with comments']
  }
  const flags = weakenedFlags(options(was), options(now)).map((flag) => `${flag} weakened`)
  const scope = scopeChanges(was, now).map((field) => `${field} changed`)
  return [...flags, ...scope]
}

export function tsconfigFinding(file: string, weakenings: readonly string[]): Finding {
  return {
    file,
    rule: 'gate/tsconfig',
    id: 'TS-01',
    message: `${weakenings.join(', ')}; revert it or get the user's approval`,
    severity: 'block',
  }
}
