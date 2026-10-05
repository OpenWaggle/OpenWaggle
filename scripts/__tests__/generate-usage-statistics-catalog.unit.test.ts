import { describe, expect, it } from 'vitest'
import { MCP_CATALOG_SERVERS } from '../../src/shared/constants/mcp'
import { USAGE_STATISTICS_BUILT_IN_SKILLS } from '../../src/shared/usage-statistics/built-in-skills'
import {
  USAGE_STATISTICS_CATALOG_MCP_SERVERS,
  USAGE_STATISTICS_CATALOG_PROVIDER_MODELS,
  USAGE_STATISTICS_CATALOG_SKILLS,
} from '../../src/shared/usage-statistics/catalog.generated'
import { catalogIdentifiers, renderUsageStatisticsCatalog } from '../generate-usage-statistics-catalog'

describe('usage statistics catalog generator', () => {
  it('keeps only identifiers the wire contract can carry, unique and sorted', () => {
    expect(
      catalogIdentifiers(['zeta', 'alpha', 'alpha', 'has space', '-leading-dash', 'x'.repeat(129)]),
    ).toEqual(['alpha', 'zeta'])
  })

  it('renders the same catalogs to the same text, sorted', () => {
    const source = {
      providerModels: new Map([
        ['zai', ['glm-5', 'glm-4.6']],
        ['anthropic', ['claude-sonnet-4-5', 'not valid!']],
      ]),
      mcpServers: ['playwright', 'chrome-devtools'],
      skills: ['visualize'],
    }
    const text = renderUsageStatisticsCatalog(source)

    expect(renderUsageStatisticsCatalog(source)).toBe(text)
    expect(text.indexOf("'anthropic'")).toBeLessThan(text.indexOf("'zai'"))
    expect(text.indexOf("'glm-4.6'")).toBeLessThan(text.indexOf("'glm-5'"))
    expect(text).not.toContain('not valid!')
    expect(text).toContain("'chrome-devtools',\n  'playwright',")
  })

  it('is generated from the current MCP catalog and built-in skills', () => {
    expect(USAGE_STATISTICS_CATALOG_MCP_SERVERS).toEqual(
      catalogIdentifiers(MCP_CATALOG_SERVERS.map((server) => server.name)),
    )
    expect(USAGE_STATISTICS_CATALOG_SKILLS).toEqual(
      catalogIdentifiers(USAGE_STATISTICS_BUILT_IN_SKILLS),
    )
    expect(Object.keys(USAGE_STATISTICS_CATALOG_PROVIDER_MODELS)).toContain('anthropic')
  })
})
