import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { buildSessionsToolPayload, createSessionsToolExtension } from '../sessions-tool-extension'
import { hiveHelpText } from './hive-help.test-utils'

const source = { sessionId: 'session-queen', runId: 'run-current' }

async function registeredHiveTool() {
  const registerTool = vi.fn()
  await createSessionsToolExtension({ ...source, workingDirectory: '/project' })(
    fromPartial<ExtensionAPI>({ registerTool }),
  )
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

  // `queueState: "running"` with `activeRunId: null` read as a stuck Session to an agent; it is a
  // Follow-up queue that is not paused on an idle Session (#351 fixed only the CLI's human output).
  it('explains status queueState and activeRunId', async () => {
    const help = JSON.parse(await hiveHelpText(await registeredHiveTool(), 'status'))
    expect(help.rules.join('\n')).toMatch(
      /status queueState running means the Follow-up queue is not paused.*activeRunId null means the Session is idle/,
    )
  })
})
