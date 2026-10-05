/**
 * Catalog enforcement for Usage statistics. Providers, models, MCP servers and skills are
 * reported only when they are public catalog identifiers; anything else becomes `custom`, as
 * the app itself reports it, so a private name never reaches PostHog even when a modified or
 * outdated app sends one. The catalogs are generated from the app's own sources
 * (scripts/generate-usage-statistics-catalog.ts).
 */
import {
  USAGE_STATISTICS_CATALOG_MCP_SERVERS,
  USAGE_STATISTICS_CATALOG_PROVIDER_MODELS,
  USAGE_STATISTICS_CATALOG_SKILLS,
} from '../../src/shared/usage-statistics/catalog.generated'
import {
  USAGE_STATISTICS_CUSTOM_IDENTIFIER,
  type UsageStatisticsEvent,
  type UsageStatisticsValue,
} from '../../src/shared/usage-statistics/contract'

const PROVIDER_MODELS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries(USAGE_STATISTICS_CATALOG_PROVIDER_MODELS).map(([provider, models]) => [
    provider,
    new Set(models),
  ]),
)
const MCP_SERVERS: ReadonlySet<string> = new Set(USAGE_STATISTICS_CATALOG_MCP_SERVERS)
const SKILLS: ReadonlySet<string> = new Set(USAGE_STATISTICS_CATALOG_SKILLS)

/** A provider and model as catalog identifiers: both `custom` for a non-catalog provider. */
function catalogProviderModel(provider: string, model: string) {
  const models = PROVIDER_MODELS.get(provider)
  if (models === undefined) {
    return {
      provider: USAGE_STATISTICS_CUSTOM_IDENTIFIER,
      model: USAGE_STATISTICS_CUSTOM_IDENTIFIER,
    }
  }
  return { provider, model: models.has(model) ? model : USAGE_STATISTICS_CUSTOM_IDENTIFIER }
}

/** List items outside `catalog` become one `custom` item; the result is sorted and unique. */
function catalogList(items: readonly string[], catalog: ReadonlySet<string>) {
  const mapped = items.map((item) =>
    catalog.has(item) ? item : USAGE_STATISTICS_CUSTOM_IDENTIFIER,
  )
  return [...new Set(mapped)].sort()
}

function stringProperty(properties: Readonly<Record<string, UsageStatisticsValue>>, key: string) {
  const value = properties[key]
  return typeof value === 'string' ? value : USAGE_STATISTICS_CUSTOM_IDENTIFIER
}

function withCatalogLists(properties: Readonly<Record<string, UsageStatisticsValue>>) {
  const result: Record<string, UsageStatisticsValue> = { ...properties }
  for (const [key, catalog] of [
    ['mcp_servers', MCP_SERVERS],
    ['skills', SKILLS],
  ] as const) {
    const value = properties[key]
    if (typeof value === 'object') result[key] = catalogList(value, catalog)
  }
  return result
}

/** The event with every catalog field reduced to catalog identifiers or `custom`. */
export function withCatalogIdentifiers(event: UsageStatisticsEvent): UsageStatisticsEvent {
  if (event.name === 'run.finished') {
    const identity = catalogProviderModel(
      stringProperty(event.properties, 'provider'),
      stringProperty(event.properties, 'model'),
    )
    return { ...event, properties: { ...event.properties, ...identity } }
  }
  if (event.name === 'install.active') {
    return { ...event, properties: withCatalogLists(event.properties) }
  }
  return event
}
