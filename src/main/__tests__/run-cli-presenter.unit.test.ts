import { SupportedModelId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { RunCliOutput } from '../run-cli-output'
import { RunCliPresenter, summarizeToolArguments } from '../run-cli-presenter'

function presenter() {
  const stdout: string[] = []
  const stderr: string[] = []
  const instance = new RunCliPresenter({
    reply: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  })
  return { instance, stdout, stderr }
}

describe('run CLI presenter', () => {
  it('summarizes common tool arguments on one line', () => {
    expect(summarizeToolArguments({ command: 'pnpm\n  test' })).toBe('pnpm test')
    expect(summarizeToolArguments({ path: 'src/index.ts', content: 'x' })).toBe('src/index.ts')
    expect(summarizeToolArguments({ other: 1 })).toBe('{"other":1}')
    expect(summarizeToolArguments(null)).toBe('')
    expect(summarizeToolArguments({ command: 'x'.repeat(200) })).toHaveLength(120)
  })

  it('ends a partial reply line before writing progress', () => {
    const { instance, stdout, stderr } = presenter()
    const update = (delta: string) =>
      instance.present({
        kind: 'session-transport',
        sessionId: 's',
        event: {
          type: 'message_update',
          timestamp: 1,
          messageId: 'm',
          role: 'assistant',
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta },
        },
      })

    update('Looking')
    instance.present({
      kind: 'session-transport',
      sessionId: 's',
      event: {
        type: 'tool_execution_end',
        timestamp: 1,
        toolCallId: 't',
        toolName: 'read',
        result: null,
        isError: true,
      },
    })
    update('Done\n')
    instance.endReplyLine()

    expect(stdout.join('')).toBe('Looking\nDone\n')
    expect(stderr.join('')).toBe('  read failed\n')
  })

  it('reports worktree setup and terminal agent errors', () => {
    const { instance, stderr } = presenter()
    instance.present({
      kind: 'session-worktree-launch',
      sessionId: 's',
      model: SupportedModelId('openai/gpt-5'),
      mode: 'classic',
      event: { type: 'failure', errorMessage: 'branch exists' },
    })
    instance.present({
      kind: 'session-transport',
      sessionId: 's',
      event: {
        type: 'agent_end',
        timestamp: 1,
        runId: 'r',
        reason: 'error',
        error: { message: 'rate limited' },
      },
    })

    instance.present({
      kind: 'session-transport',
      sessionId: 's',
      event: {
        type: 'agent_end',
        timestamp: 2,
        runId: 'r',
        reason: 'aborted',
        error: { message: 'Request aborted' },
      },
    })

    expect(stderr.join('')).toBe(
      'openwaggle: worktree setup failed: branch exists\nopenwaggle: error: rate limited\n',
    )
  })
})

describe('run CLI presenter on a terminal', () => {
  it('writes a held emoji before a progress note that interrupts the reply line', async () => {
    const combined: string[] = []
    const output = new RunCliOutput(
      {
        writeStdout: async (text) => {
          combined.push(`out:${text}`)
        },
        writeStderr: (text) => combined.push(`err:${text}`),
        stdoutIsTerminal: true,
      },
      () => undefined,
    )
    const instance = new RunCliPresenter({
      reply: (text) => output.reply(text),
      stderr: (text) => output.stderr(text),
    })
    const update = (delta: string) =>
      instance.present({
        kind: 'session-transport',
        sessionId: 's',
        event: {
          type: 'message_update',
          timestamp: 1,
          messageId: 'm',
          role: 'assistant',
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta },
        },
      })

    update('Done \u2764')
    update('\ufe0f')
    instance.status('retrying')
    await output.flushed()

    expect(combined.join('')).toBe('out:Done out:\u2764\ufe0f\nerr:openwaggle: retrying\n')
  })
})
