import { match } from '@diegogbrisa/ts-match'
import type { ModelDisplayInfo } from '@shared/types/llm'
import type { Provider } from '@shared/types/settings'

/** One provider's models as the Available Models list shows them. */
export interface AvailableModelsProvider {
  readonly provider: Provider
  readonly label: string
  readonly connected: boolean
  readonly models: readonly ModelDisplayInfo[]
}

export type ModelFilterId = 'selected' | 'ready' | 'reasoning' | 'long-context'

export const ALL_PROVIDERS = 'all'
export type ProviderScope = Provider | typeof ALL_PROVIDERS

interface AvailableModelsQuery {
  readonly search: string
  readonly filters: ReadonlySet<ModelFilterId>
}

const LONG_CONTEXT_TOKENS = 1_000_000

export const MODEL_FILTER_IDS: readonly ModelFilterId[] = [
  'selected',
  'ready',
  'reasoning',
  'long-context',
]

export function isReasoningModel(model: ModelDisplayInfo) {
  return model.availableThinkingLevels.some((level) => level !== 'off')
}

function passesFilter(
  filter: ModelFilterId,
  model: ModelDisplayInfo,
  enabled: ReadonlySet<string>,
) {
  return match(filter)
    .with('selected', () => enabled.has(model.id))
    .with('ready', () => model.available)
    .with('reasoning', () => isReasoningModel(model))
    .with('long-context', () => (model.contextWindow ?? 0) >= LONG_CONTEXT_TOKENS)
    .exhaustive()
}

/** Lower-cased search words; every word must appear somewhere in the model's searchable text. */
function searchTokens(search: string) {
  return search.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function matchesSearch(model: ModelDisplayInfo, providerLabel: string, tokens: readonly string[]) {
  if (tokens.length === 0) return true
  const haystack = `${model.name} ${model.modelId} ${providerLabel}`.toLowerCase()
  return tokens.every((token) => haystack.includes(token))
}

function isQueryActive(query: AvailableModelsQuery) {
  return searchTokens(query.search).length > 0 || query.filters.size > 0
}

/**
 * Models in each provider that match the search and active filters. `exceptFilter` leaves one
 * filter out, so a filter chip can show how many models it would leave if it were turned on.
 */
function matchingModelsByProvider(
  providers: readonly AvailableModelsProvider[],
  query: AvailableModelsQuery,
  enabled: ReadonlySet<string>,
  exceptFilter?: ModelFilterId,
): ReadonlyMap<Provider, readonly ModelDisplayInfo[]> {
  const tokens = searchTokens(query.search)
  const activeFilters = [...query.filters].filter((filter) => filter !== exceptFilter)
  return new Map(
    providers.map((group) => [
      group.provider,
      group.models.filter(
        (model) =>
          matchesSearch(model, group.label, tokens) &&
          activeFilters.every((filter) => passesFilter(filter, model, enabled)),
      ),
    ]),
  )
}

/** How many models in scope each filter chip would leave, given the search and the other filters. */
function filterCounts(
  providers: readonly AvailableModelsProvider[],
  query: AvailableModelsQuery,
  enabled: ReadonlySet<string>,
  scope: ProviderScope,
): Readonly<Record<ModelFilterId, number>> {
  const count = (filter: ModelFilterId) => {
    const matches = matchingModelsByProvider(providers, query, enabled, filter)
    let total = 0
    for (const [provider, models] of matches) {
      if (scope !== ALL_PROVIDERS && provider !== scope) continue
      total += models.filter((model) => passesFilter(filter, model, enabled)).length
    }
    return total
  }
  return {
    selected: count('selected'),
    ready: count('ready'),
    reasoning: count('reasoning'),
    'long-context': count('long-context'),
  }
}

interface HighlightSegment {
  /** Offset of the segment in the original text; unique, so it can key a rendered run. */
  readonly start: number
  readonly text: string
  readonly match: boolean
}

/** Splits `text` into runs that do or do not match any search word, for highlighting. */
export function highlightSegments(text: string, search: string): readonly HighlightSegment[] {
  const tokens = searchTokens(search)
  if (tokens.length === 0 || text.length === 0) return [{ start: 0, text, match: false }]
  const lower = text.toLowerCase()
  const marked = new Array<boolean>(text.length).fill(false)
  for (const token of tokens) {
    let index = lower.indexOf(token)
    while (index !== -1) {
      marked.fill(true, index, index + token.length)
      index = lower.indexOf(token, index + 1)
    }
  }
  const segments: HighlightSegment[] = []
  let start = 0
  for (let index = 1; index <= text.length; index += 1) {
    if (index === text.length || marked[index] !== marked[start]) {
      segments.push({ start, text: text.slice(start, index), match: marked[start] ?? false })
      start = index
    }
  }
  return segments
}

/** Everything the Available Models list shows for one search, filter set and provider choice. */
export function availableModelsView<TGroup extends AvailableModelsProvider>(
  groups: readonly TGroup[],
  query: AvailableModelsQuery,
  enabled: ReadonlySet<string>,
  chosenScope: ProviderScope | null,
) {
  // Until the user picks one, open the first signed-in provider rather than every model at once.
  const defaultScope = (groups.find((group) => group.connected) ?? groups[0])?.provider
  const chosenIsAvailable =
    chosenScope === ALL_PROVIDERS || groups.some((group) => group.provider === chosenScope)
  const scope: ProviderScope =
    chosenIsAvailable && chosenScope !== null ? chosenScope : (defaultScope ?? ALL_PROVIDERS)
  const scopedGroup = groups.find((group) => group.provider === scope) ?? null

  const matches = matchingModelsByProvider(groups, query, enabled)
  const allMatches = [...matches.values()].flat()
  const visibleModels = scopedGroup ? (matches.get(scopedGroup.provider) ?? []) : allMatches

  return {
    scope,
    scopedGroup,
    matches,
    visibleModels,
    scopeModels: scopedGroup ? scopedGroup.models : groups.flatMap((group) => group.models),
    matchesElsewhere: allMatches.length - visibleModels.length,
    counts: filterCounts(groups, query, enabled, scope),
    queryActive: isQueryActive(query),
  }
}
