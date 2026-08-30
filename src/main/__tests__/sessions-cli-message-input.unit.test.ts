import { describe, expect, it, vi } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { resolveSessionsCliMessageInput } from '../sessions-cli-message-input'

function argumentsFor(values: readonly string[]) {
  return parseMcpCliArguments(values)
}

describe('Sessions CLI explicit message input', () => {
  it('requires exactly one explicit source and rejects positional message text', async () => {
    await expect(
      resolveSessionsCliMessageInput('message', argumentsFor(['session-1'])),
    ).rejects.toThrow('Exactly one message input')
    await expect(
      resolveSessionsCliMessageInput(
        'message',
        argumentsFor(['session-1', 'implicit', '--text', 'explicit']),
      ),
    ).rejects.toThrow('one target positional')
    await expect(
      resolveSessionsCliMessageInput(
        'message',
        argumentsFor(['session-1', '--text', 'one', '--stdin']),
      ),
    ).rejects.toThrow('Exactly one message input')
  })

  it('reads stdin only when explicitly selected', async () => {
    const readStdin = vi.fn(async () => 'multiline\nmessage')
    const resolved = await resolveSessionsCliMessageInput(
      'follow-up',
      argumentsFor(['session-1', '--stdin']),
      { readStdin },
    )

    expect(readStdin).toHaveBeenCalledOnce()
    expect(resolved.arguments.options.get('text')).toEqual(['multiline\nmessage'])
  })

  it('reads a UTF-8 file and keeps non-message commands from accepting input', async () => {
    const readFile = vi.fn(async () => 'from file')
    const resolved = await resolveSessionsCliMessageInput(
      'launch',
      argumentsFor(['/project', '--input-file', '/tmp/prompt.md']),
      { readFile },
    )
    expect(readFile).toHaveBeenCalledWith('/tmp/prompt.md')
    expect(resolved.arguments.options.get('text')).toEqual(['from file'])
    await expect(
      resolveSessionsCliMessageInput('list', argumentsFor(['--text', 'no'])),
    ).rejects.toThrow('does not accept message input')
  })

  it('accepts a complete exact typed request from a named JSON source', async () => {
    const request = {
      contract: 'session-control-v2',
      request: {
        contractVersion: 2,
        requestId: 'request-message',
        idempotencyKey: 'message-once',
        command: {
          operation: 'message',
          sessionId: 'session-1',
          input: { text: 'typed request', attachmentIds: [] },
        },
      },
    }
    const resolved = await resolveSessionsCliMessageInput(
      'message',
      argumentsFor(['session-1', '--request-json', '/tmp/request.json']),
      { readFile: async () => JSON.stringify(request) },
    )
    expect(resolved.payload).toEqual(request)

    await expect(
      resolveSessionsCliMessageInput(
        'steer',
        argumentsFor(['session-1', '--request-json', '/tmp/request.json']),
        { readFile: async () => JSON.stringify(request) },
      ),
    ).rejects.toThrow('operation must be steer')
  })
})
