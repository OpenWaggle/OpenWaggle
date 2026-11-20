import { parseModelRef } from '../types/llm'

/**
 * Which Pi providers a project's Sessions may use (CONTEXT.md, "Provider restriction").
 *
 * A scope states a choice per provider: `true` grants it, `false` withdraws it, and an
 * unmentioned provider falls through to the next scope. A scope may instead close itself with
 * the reserved `only` key: `"only": ["amazon-bedrock"]` permits exactly the named providers and
 * refuses every other one there, including a provider an outer scope allows. A deeper scope
 * still grants explicitly, so no scope seals its descendants.
 */

/**
 * One scope's per-provider choice. A provider absent from the record is unmentioned. The
 * reserved `only` key carries a non-empty provider-id list instead of a boolean.
 */
export type ProviderRestrictionScope = Readonly<Record<string, boolean | readonly string[]>>

/** Every configured path scope, keyed by canonical absolute path. */
export type ProviderRestrictionsByPath = Readonly<Record<string, ProviderRestrictionScope>>

/** The reserved scope key that closes a scope to exactly the providers it names. */
export const PROVIDER_RESTRICTION_ONLY_KEY = 'only'

/**
 * A path to compare scopes with: separators normalized to `/` (Windows paths arrive with
 * backslashes) and trailing separators dropped, as `formatWorktreePathForDisplay` does. The
 * util is shared with the renderer bundle, so it does not import `node:path`.
 */
function normalizePath(value: string) {
  const slashed = value.replace(/\\/gu, '/')
  return slashed.length > 1 ? slashed.replace(/\/+$/u, '') : slashed
}

/**
 * Why a path cannot be a **Provider scope**, or null when it can: the home directory itself is the
 * app-wide setting, anything above or outside it would restate a broader scope instead of
 * naming one, a path that is not normalized would never match a canonical project, and
 * OpenWaggle's own folders are not project folders. The settings update applies it, and the
 * Settings form shows the refusal it returns.
 */
export function providerScopePathRejection(scopePath: string, homeDir: string) {
  if (
    scopePath
      .trim()
      .split(/[/\\]+/u)
      .includes('..')
  ) {
    return `"${scopePath}" is not a normalized path; a provider scope must name a folder without ".." in it.`
  }
  const scoped = normalizePath(scopePath)
  const home = normalizePath(homeDir)
  if (scoped === home || !scoped.startsWith(`${home}/`)) {
    return `A provider scope must be a folder inside your home directory, not "${scopePath}": the home directory itself is the app-wide restriction.`
  }
  if (scoped === `${home}/.openwaggle` || scoped.startsWith(`${home}/.openwaggle/`)) {
    return `"${scopePath}" is inside OpenWaggle's own configuration; a provider scope must name one of your project folders.`
  }
  return null
}

export interface ProviderRestrictionInput {
  /** The Session's project path, canonicalized by the caller. */
  readonly projectPath: string
  /** Path scopes by canonical absolute path, each covering every project beneath it. */
  readonly byPath?: Readonly<Record<string, ProviderRestrictionScope>>
  /** The project's own settings file, which outranks every path scope. */
  readonly projectOverride?: ProviderRestrictionScope
  /** The app-wide choice, the last scope consulted. */
  readonly appWide?: ProviderRestrictionScope
  /** Aliased paths recorded before canonicalization: alias -> canonical target. */
  readonly aliases?: Readonly<Record<string, string>>
}

/** Whether `scopePath` is `projectPath` itself or an ancestor directory of it. */
function contains(scopePath: string, projectPath: string) {
  const scoped = normalizePath(scopePath)
  const project = normalizePath(projectPath)
  return scoped === project || project.startsWith(`${scoped}/`)
}

/** What resolving one model against a project's restriction decided. */
export type ProviderRestrictedModel =
  | { readonly kind: 'allowed'; readonly modelId: string }
  | { readonly kind: 'refused'; readonly message: string }

export interface ResolvedProviderRestriction {
  readonly allows: (provider: string) => boolean
}

/**
 * A restriction refuses a model the caller named and never one OpenWaggle derived: a named model
 * outside the scope fails the request, a derived one resolves again to the first enabled model
 * of an allowed provider. A model reference no provider restriction can parse is left alone.
 */
export function resolveModelWithinProviderRestriction(input: {
  readonly modelId: string
  /** Whether the caller named this model: a specialization or an Agent definition chose it. */
  readonly named: boolean
  readonly restriction: ResolvedProviderRestriction
  readonly enabledModels: readonly string[]
}) {
  // Pi resolves a trimmed reference, so the provider it will run is the trimmed one's.
  const parsed = parseModelRef(input.modelId.trim())
  if (!parsed || input.restriction.allows(parsed.provider)) {
    return { kind: 'allowed', modelId: input.modelId } satisfies ProviderRestrictedModel
  }
  if (input.named) {
    return {
      kind: 'refused',
      message: `Model ${JSON.stringify(input.modelId)} uses provider ${JSON.stringify(parsed.provider)}, which this project's provider restrictions do not allow.`,
    } satisfies ProviderRestrictedModel
  }
  const replacement = input.enabledModels.find((candidate) => {
    const candidateParsed = parseModelRef(candidate)
    return candidateParsed !== null && input.restriction.allows(candidateParsed.provider)
  })
  return replacement
    ? ({ kind: 'allowed', modelId: replacement } satisfies ProviderRestrictedModel)
    : ({
        kind: 'refused',
        message:
          "No enabled model uses a provider this project allows. Enable a model from an allowed provider, or adjust the project's provider restrictions.",
      } satisfies ProviderRestrictedModel)
}

export function resolveProviderRestriction(input: ProviderRestrictionInput) {
  const aliases = input.aliases ?? {}
  // A scope recorded under a path a project was opened through before it was canonicalized must
  // keep matching, and a project reached through such a path must still find its scopes.
  const projectPath = aliases[input.projectPath] ?? input.projectPath
  const scopes: ProviderRestrictionScope[] = []
  // Most specific first: the project's own file, then its containing scopes deepest-first,
  // then the app-wide choice.
  if (input.projectOverride) scopes.push(input.projectOverride)
  scopes.push(
    ...Object.entries(input.byPath ?? {})
      .map(([scopePath, scope]) => [aliases[scopePath] ?? scopePath, scope] as const)
      .filter(([scopePath]) => contains(scopePath, projectPath))
      .sort(([left], [right]) => right.length - left.length)
      .map(([, scope]) => scope),
  )
  if (input.appWide) scopes.push(input.appWide)

  return {
    allows: (provider: string) => {
      // The reserved key is scope syntax, never a provider id.
      if (provider === PROVIDER_RESTRICTION_ONLY_KEY) return true
      for (const scope of scopes) {
        // A malformed `only` value fails closed: it refuses every provider rather than
        // silently reopening the scope the person meant to close.
        if (PROVIDER_RESTRICTION_ONLY_KEY in scope) {
          const only = scope[PROVIDER_RESTRICTION_ONLY_KEY]
          return Array.isArray(only) && only.includes(provider)
        }
        const choice = scope[provider]
        if (typeof choice === 'boolean') return choice
      }
      return true
    },
  }
}
