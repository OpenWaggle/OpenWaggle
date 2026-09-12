import { describe, expect, it } from 'vitest'
import { buildSessionsToolPayload } from '../adapters/pi/sessions-tool-extension'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { buildMcpSessionPayloadV2 } from '../openwaggle-mcp-session-input-v2'
import { buildSessionsCliPayload } from '../sessions-cli'

describe('Session organization adapters', () => {
  it('maps rename, archive, and handoff through CLI, MCP, and the native Sessions tool', () => {
    expect(
      buildSessionsCliPayload('rename', parseMcpCliArguments(['worker', 'Clear title'])),
    ).toMatchObject({
      request: { command: { operation: 'rename', sessionId: 'worker', title: 'Clear title' } },
    })
    expect(buildMcpSessionPayloadV2({ operation: 'archive', sessionId: 'worker' })).toMatchObject({
      request: { command: { operation: 'archive', sessionId: 'worker' } },
    })
    expect(
      buildSessionsToolPayload(
        {
          action: 'handoff',
          sessionId: 'worker',
          workspace: 'new-worktree',
          baseRef: 'main',
        },
        { sessionId: 'queen', runId: 'run-queen' },
      ),
    ).toMatchObject({
      request: {
        command: {
          operation: 'handoff',
          sessionId: 'worker',
          workspace: { mode: 'new-worktree', baseRef: 'main' },
        },
      },
    })
    expect(
      buildSessionsCliPayload('handoff', parseMcpCliArguments(['worker', '--workspace', 'local'])),
    ).toMatchObject({
      request: {
        command: { operation: 'handoff', sessionId: 'worker', workspace: { mode: 'local' } },
      },
    })
  })
})
