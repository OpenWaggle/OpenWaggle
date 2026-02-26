type Primitive = string | number | boolean | bigint | symbol | null | undefined

const RULE_TOKEN = Symbol('decision.rule')

type RuleTag = 'any' | 'guard' | 'either' | 'object' | 'array' | 'exclude'

interface BaseRule<TTag extends RuleTag> {
  readonly [RULE_TOKEN]: TTag
}

interface AnyRule extends BaseRule<'any'> {}

interface GuardRule<TInput, _TGuarded extends TInput = TInput> extends BaseRule<'guard'> {
  readonly predicate: (value: TInput) => boolean
}

interface EitherRule<TRules extends readonly unknown[]> extends BaseRule<'either'> {
  readonly rules: TRules
}

interface ObjectRule<TShape extends Record<string, unknown>> extends BaseRule<'object'> {
  readonly shape: TShape
}

interface ArrayRule<TRule> extends BaseRule<'array'> {
  readonly item: TRule
}

interface ExcludeRule<TRule> extends BaseRule<'exclude'> {
  readonly rule: TRule
}

type RuleValue =
  | AnyRule
  | GuardRule<unknown>
  | EitherRule<readonly unknown[]>
  | ObjectRule<Record<string, unknown>>
  | ArrayRule<unknown>
  | ExcludeRule<unknown>

export type DecisionRule = Primitive | RuleValue | DecisionRuleArray | DecisionRuleObject

interface DecisionRuleArray extends ReadonlyArray<DecisionRule> {}

interface DecisionRuleObject {
  readonly [key: string]: DecisionRule
}

type NarrowByRules<TValue, TRules extends readonly unknown[]> = TRules[number] extends infer TItem
  ? NarrowByRule<TValue, TItem>
  : never

export type NarrowByRule<TValue, TRule> = TRule extends AnyRule
  ? TValue
  : TRule extends GuardRule<infer _TInput, infer TGuarded>
    ? Extract<TValue, TGuarded>
    : TRule extends EitherRule<infer TRules>
      ? NarrowByRules<TValue, TRules>
      : TRule extends ExcludeRule<infer TInner>
        ? Exclude<TValue, NarrowByRule<TValue, TInner>>
        : TRule extends Primitive
          ? Extract<TValue, TRule>
          : TRule extends readonly unknown[]
            ? Extract<TValue, readonly unknown[]>
            : TRule extends Record<string, unknown>
              ? Extract<TValue, Record<string, unknown>>
              : never

interface MatchFound<TResult> {
  readonly matched: true
  readonly result: TResult
}

interface MatchNotFound {
  readonly matched: false
}

type MatchResult<TResult> = MatchFound<TResult> | MatchNotFound

interface ChooseBuilder<TValue, TOutput> {
  case<TRule, TResult>(
    rule: TRule,
    handler: (value: TValue) => TResult,
  ): ChooseBuilder<TValue, TOutput | TResult>
  catchAll<TResult>(handler: (value: TValue) => TResult): TOutput | TResult
  assertComplete(): TOutput
}

interface ChooseByBuilder<
  TValue extends Record<TKey, PropertyKey>,
  TKey extends keyof TValue & PropertyKey,
  TRemainingTags extends TValue[TKey],
  TOutput,
> {
  case<TTag extends TRemainingTags, TResult>(
    tag: TTag,
    handler: (value: Extract<TValue, Record<TKey, TTag>>) => TResult,
  ): ChooseByBuilder<TValue, TKey, Exclude<TRemainingTags, TTag>, TOutput | TResult>
  catchAll<TResult>(handler: (value: TValue) => TResult): TOutput | TResult
  assertComplete(
    ...args: [TRemainingTags] extends [never] ? [] : [missingTags: TRemainingTags]
  ): TOutput
}

function isNonNullObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasRuleTag(value: unknown): value is BaseRule<RuleTag> {
  return isNonNullObject(value) && RULE_TOKEN in value
}

function isAnyRule(value: unknown): value is AnyRule {
  return hasRuleTag(value) && value[RULE_TOKEN] === 'any'
}

function isGuardRule(value: unknown): value is GuardRule<unknown> {
  return hasRuleTag(value) && value[RULE_TOKEN] === 'guard'
}

function isEitherRule(value: unknown): value is EitherRule<readonly unknown[]> {
  return hasRuleTag(value) && value[RULE_TOKEN] === 'either'
}

function isObjectRule(value: unknown): value is ObjectRule<Record<string, unknown>> {
  return hasRuleTag(value) && value[RULE_TOKEN] === 'object'
}

function isArrayRule(value: unknown): value is ArrayRule<unknown> {
  return hasRuleTag(value) && value[RULE_TOKEN] === 'array'
}

function isExcludeRule(value: unknown): value is ExcludeRule<unknown> {
  return hasRuleTag(value) && value[RULE_TOKEN] === 'exclude'
}

function matchesShape(value: Record<string, unknown>, shape: Record<string, unknown>): boolean {
  for (const [key, pattern] of Object.entries(shape)) {
    if (!(key in value)) return false
    if (!matchesRule(value[key], pattern)) return false
  }
  return true
}

function matchesRule(value: unknown, rule: unknown): boolean {
  if (isAnyRule(rule)) return true
  if (isGuardRule(rule)) return rule.predicate(value)

  if (isEitherRule(rule)) {
    for (const option of rule.rules) {
      if (matchesRule(value, option)) return true
    }
    return false
  }

  if (isExcludeRule(rule)) return !matchesRule(value, rule.rule)

  if (isArrayRule(rule)) {
    if (!Array.isArray(value)) return false
    for (const item of value) {
      if (!matchesRule(item, rule.item)) return false
    }
    return true
  }

  if (isObjectRule(rule)) {
    if (!isRecord(value)) return false
    return matchesShape(value, rule.shape)
  }

  if (Array.isArray(rule)) {
    if (!Array.isArray(value)) return false
    if (value.length !== rule.length) return false

    for (let index = 0; index < rule.length; index += 1) {
      if (!matchesRule(value[index], rule[index])) return false
    }

    return true
  }

  if (isRecord(rule)) {
    if (!isRecord(value)) return false
    return matchesShape(value, rule)
  }

  return Object.is(value, rule)
}

function ruleMatches<TValue, TRule>(
  value: TValue,
  rule: TRule,
): value is NarrowByRule<TValue, TRule> {
  return matchesRule(value, rule)
}

function hasTag<
  TValue extends Record<TKey, PropertyKey>,
  TKey extends keyof TValue & PropertyKey,
  TTag extends TValue[TKey],
>(value: TValue, key: TKey, tag: TTag): value is Extract<TValue, Record<TKey, TTag>> {
  return value[key] === tag
}

function createChooseBuilder<TValue, TOutput>(
  value: TValue,
  resolver: () => MatchResult<TOutput>,
): ChooseBuilder<TValue, TOutput> {
  return {
    case(rule, handler) {
      const nextResolver = (): MatchResult<TOutput | ReturnType<typeof handler>> => {
        const resolved = resolver()
        if (resolved.matched) return resolved

        if (ruleMatches(value, rule)) {
          return {
            matched: true,
            result: handler(value),
          }
        }

        return { matched: false }
      }

      return createChooseBuilder(value, nextResolver)
    },

    catchAll(handler) {
      const resolved = resolver()
      if (resolved.matched) return resolved.result
      return handler(value)
    },

    assertComplete() {
      const resolved = resolver()
      if (resolved.matched) return resolved.result
      throw new Error('Decision tree was not complete for value.')
    },
  }
}

function createChooseByBuilder<
  TValue extends Record<TKey, PropertyKey>,
  TKey extends keyof TValue & PropertyKey,
  TRemainingTags extends TValue[TKey],
  TOutput,
>(
  value: TValue,
  key: TKey,
  resolver: () => MatchResult<TOutput>,
): ChooseByBuilder<TValue, TKey, TRemainingTags, TOutput> {
  return {
    case(tag, handler) {
      const nextResolver = (): MatchResult<TOutput | ReturnType<typeof handler>> => {
        const resolved = resolver()
        if (resolved.matched) return resolved

        if (hasTag(value, key, tag)) {
          return {
            matched: true,
            result: handler(value),
          }
        }

        return { matched: false }
      }

      return createChooseByBuilder<
        TValue,
        TKey,
        Exclude<TRemainingTags, typeof tag>,
        TOutput | ReturnType<typeof handler>
      >(value, key, nextResolver)
    },

    catchAll(handler) {
      const resolved = resolver()
      if (resolved.matched) return resolved.result
      return handler(value)
    },

    assertComplete(..._args) {
      const resolved = resolver()
      if (resolved.matched) return resolved.result

      throw new Error(
        `Decision tree is missing a case for tag "${String(value[key])}" on key "${String(key)}".`,
      )
    },
  }
}

function guard<TInput, TGuarded extends TInput>(
  predicate: (value: TInput) => value is TGuarded,
): GuardRule<TInput, TGuarded>
function guard<TInput>(predicate: (value: TInput) => boolean): GuardRule<TInput>
function guard<TInput>(predicate: (value: TInput) => boolean): GuardRule<TInput> {
  return {
    [RULE_TOKEN]: 'guard',
    predicate,
  }
}

function either<TRules extends readonly unknown[]>(...rules: TRules): EitherRule<TRules> {
  return {
    [RULE_TOKEN]: 'either',
    rules,
  }
}

function object<TShape extends Record<string, unknown>>(shape: TShape): ObjectRule<TShape> {
  return {
    [RULE_TOKEN]: 'object',
    shape,
  }
}

function array<TRule>(item: TRule): ArrayRule<TRule> {
  return {
    [RULE_TOKEN]: 'array',
    item,
  }
}

function exclude<TRule>(rule: TRule): ExcludeRule<TRule> {
  return {
    [RULE_TOKEN]: 'exclude',
    rule,
  }
}

const anyRule: AnyRule = {
  [RULE_TOKEN]: 'any',
}

export const Rule = {
  any: anyRule,
  guard,
  either,
  object,
  array,
  exclude,
}

export function choose<TValue>(value: TValue): ChooseBuilder<TValue, never> {
  return createChooseBuilder(value, () => ({ matched: false }))
}

export function chooseBy<
  TValue extends Record<TKey, PropertyKey>,
  TKey extends keyof TValue & PropertyKey,
>(value: TValue, key: TKey): ChooseByBuilder<TValue, TKey, TValue[TKey], never> {
  return createChooseByBuilder(value, key, () => ({ matched: false }))
}
