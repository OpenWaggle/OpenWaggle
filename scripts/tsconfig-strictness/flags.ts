/**
 * The strictness a TypeScript project applies to its files, flag by flag, as a rank where higher
 * is stricter. no-cheating/tsconfig compares ranks: a tsconfig change may raise a file's rank on a
 * flag or keep it, never lower it. `types` and `lib` are not strictness: narrowing them is allowed.
 */
type Options = Readonly<Record<string, unknown>>

const ON = 1
const OFF = 0
/** `allowUnreachableCode`/`allowUnusedLabels`: `false` errors, unset warns, `true` allows. */
const ERRORS = 2
const WARNS = 1

/** TypeScript 7 turns `strict` on when a config does not set it. */
const STRICT_DEFAULT = true

/** Flags that `strict` turns on unless a config sets them. */
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

/** Flags that check more when on. Unset counts as off. */
const STRICT_WHEN_ON = [
  'noUncheckedIndexedAccess',
  'noUncheckedSideEffectImports',
  'exactOptionalPropertyTypes',
  'noPropertyAccessFromIndexSignature',
  'noImplicitReturns',
  'noImplicitOverride',
  'noUnusedLocals',
  'noUnusedParameters',
  'noFallthroughCasesInSwitch',
  'verbatimModuleSyntax',
  'erasableSyntaxOnly',
  'isolatedModules',
  'isolatedDeclarations',
  'checkJs',
] as const

/** Flags that check less when on. Unset counts as off. */
const WEAKER_WHEN_ON = ['skipLibCheck', 'skipDefaultLibCheck', 'noCheck'] as const

/** Flags whose `false` errors, unset warns and `true` allows. */
const ERROR_WHEN_FALSE = ['allowUnreachableCode', 'allowUnusedLabels'] as const

export const STRICTNESS_FLAGS: readonly string[] = [
  'strict',
  ...STRICT_FAMILY,
  ...STRICT_WHEN_ON,
  'forceConsistentCasingInFileNames',
  ...WEAKER_WHEN_ON,
  ...ERROR_WHEN_FALSE,
]

export type StrictnessRanks = Readonly<Record<string, number>>

function rank(value: boolean) {
  return value ? ON : OFF
}

/** The rank of every strictness flag under one project's resolved compiler options. */
export function strictnessRanks(options: Options): StrictnessRanks {
  const strict = options.strict ?? STRICT_DEFAULT
  const ranks: Record<string, number> = { strict: rank(strict === true) }
  for (const flag of STRICT_FAMILY) ranks[flag] = rank((options[flag] ?? strict) === true)
  for (const flag of STRICT_WHEN_ON) ranks[flag] = rank(options[flag] === true)
  // On by default since TypeScript 5.
  ranks.forceConsistentCasingInFileNames = rank(options.forceConsistentCasingInFileNames !== false)
  for (const flag of WEAKER_WHEN_ON) ranks[flag] = rank(options[flag] !== true)
  for (const flag of ERROR_WHEN_FALSE) {
    const value = options[flag]
    ranks[flag] = value === false ? ERRORS : value === undefined ? WARNS : OFF
  }
  return ranks
}

/** The stricter of two rank sets, flag by flag: a file checked by both gets both checks. */
export function strictest(left: StrictnessRanks, right: StrictnessRanks): StrictnessRanks {
  return Object.fromEntries(
    STRICTNESS_FLAGS.map((flag) => [flag, Math.max(left[flag] ?? OFF, right[flag] ?? OFF)]),
  )
}
