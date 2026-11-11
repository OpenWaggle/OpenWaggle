import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { SessionCapability } from '@shared/types/session-capability'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { buildSessionsToolPayload, createSessionsToolExtension } from '../sessions-tool-extension'
import { hiveHelpText } from './hive-help.test-utils'

const source = { sessionId: 'session-queen', runId: 'run-current' }

async function registeredHiveTool(sessionCapabilities?: readonly SessionCapability[]) {
  const registerTool = vi.fn()
  createSessionsToolExtension({
    ...source,
    workingDirectory: '/project',
    ...(sessionCapabilities ? { sessionCapabilities } : {}),
  })(fromPartial<ExtensionAPI>({ registerTool }))
  return registerTool.mock.calls[0]?.[0]
}

// An agent asked to find an archived Session could only list archived ones and page through
// titles: search had no way to reach them, although the Host and the CLI (`--include-archived`)
// already searched archived transcripts.
describe('Hive tool search of archived Sessions', () => {
  it('forwards includeArchived to the Session query', () => {
    expect(
      buildSessionsToolPayload(
        {
          action: 'search',
          query: 'earendil-works/pi/issues/11527',
          catalogScope: 'all',
          fullTranscript: true,
          includeArchived: true,
        },
        source,
      ),
    ).toMatchObject({
      request: {
        query: {
          operation: 'search',
          searchScope: 'full-transcript',
          includeArchived: true,
        },
      },
    })
  })

  it('leaves archived Sessions out of search by default', () => {
    const payload = buildSessionsToolPayload({ action: 'search', query: 'queen' }, source)
    expect(payload).toMatchObject({ request: { query: { operation: 'search' } } })
    expect(JSON.stringify(payload)).not.toContain('includeArchived')
  })

  it('names includeArchived in the search schema and its help rules', async () => {
    const help = JSON.parse(await hiveHelpText(await registeredHiveTool(), 'search'))
    expect(Object.keys(help.parameters.properties)).toContain('includeArchived')
    expect(help.rules.join('\n')).toMatch(
      /search leaves archived Sessions out unless includeArchived is true/,
    )
  })

  it('offers fullTranscript and a wider scope for the retry only when the grant can use them', async () => {
    const queen = JSON.parse(await hiveHelpText(await registeredHiveTool(), 'search')).rules.join(
      '\n',
    )
    expect(queen).toMatch(
      /search again with includeArchived and fullTranscript, and catalogScope all if it may be in another project/,
    )
    expect(queen).toMatch(/A later page's cursor needs the same options/)

    // A full-transcript search also needs sessions:read, so a discover-only grant is not told to.
    const discoverOnly = JSON.parse(
      await hiveHelpText(await registeredHiveTool(['sessions:discover']), 'search'),
    ).rules.join('\n')
    expect(discoverOnly).toMatch(/search again with includeArchived, and catalogScope all/)
    expect(discoverOnly).not.toContain('fullTranscript')
  })
})
