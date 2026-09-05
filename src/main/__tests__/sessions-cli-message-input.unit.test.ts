import { describe, expect, it, vi } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { resolveSessionsCliMessageInput } from '../sessions-cli-message-input'

function argumentsFor(values: readonly string[]) {
  return parseMcpCliArguments(values)
}

function lifecycleRequest(command: object) {
  return {
    contract: 'session-lifecycle-v2',
    request: {
      contractVersion: 2,
      requestId: 'request-lifecycle',
      idempotencyKey: 'lifecycle-once',
      command,
    },
  }
}

function controlRequest(command: object) {
  return {
    contract: 'session-control-v2',
    request: {
      contractVersion: 2,
      requestId: 'request-control',
      idempotencyKey: 'control-once',
      command,
    },
  }
}

const requestTargetCases = [
  {
    command: 'launch',
    positionalTarget: '.',
    request: lifecycleRequest({
      operation: 'launch',
      projectPath: './',
      objective: 'Launch work',
      attachmentIds: [],
    }),
  },
  {
    command: 'spawn',
    positionalTarget: 'session-parent',
    request: lifecycleRequest({
      operation: 'spawn',
      parentSessionId: 'session-parent',
      expectedParentRunId: 'run-parent',
      delegation: {
        objective: 'Spawn work',
        deliverables: [],
        acceptanceCriteria: [],
        dependencies: [],
        resourceReferences: [],
      },
    }),
  },
  {
    command: 'message',
    positionalTarget: 'session-1',
    request: controlRequest({
      operation: 'message',
      sessionId: 'session-1',
      input: { text: 'Message', attachmentIds: [] },
    }),
  },
  {
    command: 'start',
    positionalTarget: 'session-1',
    request: controlRequest({
      operation: 'start',
      sessionId: 'session-1',
      input: { text: 'Start', attachmentIds: [] },
    }),
  },
  {
    command: 'follow-up',
    positionalTarget: 'session-1',
    request: controlRequest({
      operation: 'follow-up',
      sessionId: 'session-1',
      input: { text: 'Follow up', attachmentIds: [] },
    }),
  },
  {
    command: 'steer',
    positionalTarget: 'session-1',
    request: controlRequest({
      operation: 'steer',
      sessionId: 'session-1',
      expectedRunId: 'run-1',
      input: { text: 'Steer', attachmentIds: [] },
    }),
  },
  {
    command: 'replace',
    positionalTarget: 'session-1',
    request: controlRequest({
      operation: 'replace',
      sessionId: 'session-1',
      expectedRunId: 'run-1',
      input: { text: 'Replace', attachmentIds: [] },
    }),
  },
  {
    command: 'report',
    positionalTarget: 'session-source',
    request: controlRequest({
      operation: 'report',
      sessionId: 'session-source',
      target: { type: 'session', sessionId: 'session-destination' },
      input: { text: 'Report', requestReply: false },
    }),
  },
] as const

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

  it.each(requestTargetCases)(
    'binds the $command request target to its positional target',
    async ({ command, positionalTarget, request }) => {
      const resolved = await resolveSessionsCliMessageInput(
        command,
        argumentsFor([positionalTarget, '--request-json', '/tmp/request.json']),
        {
          readFile: async () => JSON.stringify(request),
          workingDirectory: '/workspace/project',
        },
      )

      if (command === 'launch' && resolved.payload?.contract === 'session-lifecycle-v2') {
        expect(resolved.payload.request.command).toMatchObject({
          operation: 'launch',
          projectPath: '/workspace/project',
        })
      } else {
        expect(resolved.payload?.request).toMatchObject(request.request)
      }
    },
  )

  it.each(requestTargetCases)(
    'rejects a $command request whose target differs from its positional target',
    async ({ command, request }) => {
      await expect(
        resolveSessionsCliMessageInput(
          command,
          argumentsFor(['different-target', '--request-json', '/tmp/request.json']),
          {
            readFile: async () => JSON.stringify(request),
            workingDirectory: '/workspace/project',
          },
        ),
      ).rejects.toThrow('target must be the same as the positional')
    },
  )

  it('binds report to its source Session rather than its delivery target', async () => {
    const reportCase = requestTargetCases.find(({ command }) => command === 'report')
    await expect(
      resolveSessionsCliMessageInput(
        'report',
        argumentsFor(['session-destination', '--request-json', '/tmp/request.json']),
        { readFile: async () => JSON.stringify(reportCase?.request) },
      ),
    ).rejects.toThrow('target must be the same as the positional')
  })
})
