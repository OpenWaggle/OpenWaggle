import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParsedArguments } from '../mcp-cli-arguments'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test' } }))
vi.mock('../cli-stdout', () => ({
  cliStdoutIsTerminal: () => false,
  writeCliStdout: async () => undefined,
}))
vi.mock('../local-session-cli-client', () => ({ createLocalSessionCliClientInput: vi.fn() }))
vi.mock('../session-host/local-session-client', () => ({
  executeLocalSessionCommand: vi.fn(),
  watchLocalSessionEvents: vi.fn(),
}))

const { listenForInterrupts, runRunCli, RUN_CLI_INTERRUPTED_EXIT } = await import('../run-cli')
const { PromptInterruptedError } = await import('../run-cli-interactions')
const {
  confirmation,
  harness,
  launchedResult,
  resetSequence,
  RUN,
  SESSION,
  settled,
  stateChanged,
  textDelta,
  transport,
} = await import('./run-cli-harness')

const commandOperations = (test: ReturnType<typeof harness>) =>
  test.commands.map((command) =>
    command.contract === 'session-query-v2'
      ? command.request.query.operation
      : command.contract === 'session-lifecycle-v2' || command.contract === 'session-control-v2'
        ? command.request.command.operation
        : command.contract,
  )

beforeEach(() => resetSequence())

describe('openwaggle run settlement', () => {
  it('settles on follow-up-started for its own Run', async () => {
    const test = harness({ afterLaunch: [settled('completed', 'follow-up-started')] })

    expect(await runRunCli(['task'], test.dependencies)).toBe(0)
  })

  it('reads the durable status when a settlement omits its terminal status', async () => {
    const test = harness({ afterLaunch: [settled()], turns: [{ runId: RUN, status: 'failed' }] })

    expect(await runRunCli(['task'], test.dependencies)).toBe(1)
    expect(commandOperations(test)).toEqual(['launch', 'turns'])
  })

  it('ends when another client replaces the Run', async () => {
    const test = harness({
      afterLaunch: [stateChanged('replace')],
      turns: [
        { runId: 'r-2', status: 'active' },
        { runId: RUN, status: 'interrupted' },
      ],
    })

    expect(await runRunCli(['task'], test.dependencies)).toBe(RUN_CLI_INTERRUPTED_EXIT)
    expect(test.stderr.join('')).toContain('Run interrupted.')
  })

  it('reads the original Run of a replayed launch instead of waiting forever', async () => {
    const test = harness({
      launchResult: launchedResult(true),
      turns: [{ runId: RUN, status: 'completed' }],
    })

    expect(await runRunCli(['task', '--idempotency-key', 'k'], test.dependencies)).toBe(0)
  })

  it('reports an interaction timeout with the timeout status', async () => {
    const test = harness({ afterLaunch: [settled('interrupted-by-interaction-timeout')] })

    expect(await runRunCli(['task'], test.dependencies)).toBe(7)
  })

  it('ends when the Session is deleted', async () => {
    const test = harness()
    const running = runRunCli(['task'], test.dependencies)
    await vi.waitFor(() => expect(test.stderr.join('')).toContain('started Session'))
    await test.emit({
      cursor: { hostInstanceId: 'host', sequence: 99 },
      timestamp: 99,
      payload: { kind: 'session-list-changed', sessionId: SESSION, change: 'deleted' },
    })

    expect(await running).toBe(5)
  })
})

describe('openwaggle run event stream', () => {
  it('fails before launching when the subscription ends first', async () => {
    const test = harness({
      createClientInput: async () => fromPartial({ clientVersion: 'test' }),
    })
    const watch = test.dependencies.watch
    const dependencies = {
      ...test.dependencies,
      watch: async () => ({ status: 'closed' as const }),
    }

    expect(await runRunCli(['task'], dependencies)).toBe(8)
    expect(watch).toBeDefined()
    expect(commandOperations(test)).toEqual([])
  })

  it('uses the durable status when the stream is lost after launch', async () => {
    const test = harness({ turns: [{ runId: RUN, status: 'completed' }] })
    const running = runRunCli(['task'], test.dependencies)
    await vi.waitFor(() => expect(test.stderr.join('')).toContain('started Session'))
    test.endWatch({
      status: 'resync-required',
      reason: 'slow-consumer',
      cursor: { hostInstanceId: 'host', sequence: 5 },
    })

    expect(await running).toBe(0)
  })

  it('reports a lost connection and still flushes output when the stream fails', async () => {
    const test = harness({ afterLaunch: [textDelta('partial')] })
    const running = runRunCli(['task'], test.dependencies)
    await vi.waitFor(() => expect(test.stderr.join('')).toContain('started Session'))
    test.failWatch(new Error('socket reset'))

    expect(await running).toBe(8)
    expect(test.stdout.join('')).toBe('partial\n')
    expect(test.stderr.join('')).toContain('lost the Session Host connection: socket reset')
  })

  it('uses the final agent_end when a stopping Host closes before settling the Run', async () => {
    const test = harness({
      afterLaunch: [
        textDelta('done'),
        transport({ type: 'agent_end', timestamp: 2, runId: RUN, reason: 'stop' }),
      ],
    })
    const running = runRunCli(['task'], test.dependencies)
    await vi.waitFor(() => expect(test.stderr.join('')).toContain('started Session'))
    test.failWatch(new Error('Local Session Host connection closed.'))

    expect(await running).toBe(0)
    expect(test.stderr.join('')).toContain('Run finished; the Session Host closed before')
  })

  it('does not buffer events of Sessions that were already running', async () => {
    const test = harness({ afterLaunch: [settled('completed')] })
    const watch = test.dependencies.watch
    const dependencies = {
      ...test.dependencies,
      watch: (input: Parameters<typeof watch>[0]) => {
        void input.onSnapshot?.(fromPartial([{ sessionId: 'busy' }]))
        return watch(input)
      },
    }
    const running = runRunCli(['task'], dependencies)

    expect(await running).toBe(0)
  })
})

describe('openwaggle run interrupts and output failures', () => {
  it('cancels before any Run exists when Ctrl-C arrives while the Host starts', async () => {
    let releaseHost: () => void = () => undefined
    const test = harness({
      createClientInput: () =>
        new Promise((resolve) => {
          releaseHost = () => resolve(fromPartial({ clientVersion: 'test' }))
        }),
    })
    const running = runRunCli(['task'], test.dependencies)
    await Promise.resolve()
    test.interrupt()

    expect(await running).toBe(RUN_CLI_INTERRUPTED_EXIT)
    releaseHost()
    expect(test.commands).toEqual([])
  })

  it('treats Ctrl-C at an approval prompt as an interrupt', async () => {
    const test = harness({
      interactive: true,
      ask: async () => {
        throw new PromptInterruptedError()
      },
      afterLaunch: [
        transport({ type: 'agent_interaction_request', timestamp: 1, interaction: confirmation }),
      ],
    })
    const running = runRunCli(['clean'], test.dependencies)
    await vi.waitFor(() => expect(commandOperations(test)).toContain('interrupt'))
    await test.emit(settled('interrupted'))

    expect(await running).toBe(RUN_CLI_INTERRUPTED_EXIT)
    expect(commandOperations(test)).not.toContain('approval-respond')
  })

  it('does not answer from a terminal whose input was consumed by --stdin', async () => {
    const test = harness({
      interactive: true,
      afterLaunch: [
        transport({ type: 'agent_interaction_request', timestamp: 1, interaction: confirmation }),
        settled('completed'),
      ],
    })

    const dependencies = {
      ...test.dependencies,
      resolveMessageInput: async (_command: string, arguments_: ParsedArguments) => ({
        arguments: {
          ...arguments_,
          options: new Map([...arguments_.options, ['text', ['piped']]]),
        },
      }),
    }

    expect(await runRunCli(['--stdin'], dependencies)).toBe(0)
    await vi.waitFor(() =>
      expect(test.stderr.join('')).toContain('openwaggle sessions requests respond'),
    )
  })

  it('interrupts the Run when stdout is closed', async () => {
    const test = harness({
      afterLaunch: [textDelta('first')],
      writeStdout: async () => {
        throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
      },
    })

    expect(await runRunCli(['task'], test.dependencies)).toBe(1)
    expect(commandOperations(test)).toContain('interrupt')
    expect(test.stderr.join('')).toContain('stdout was closed')
  })

  it('shows terminal control sequences in agent-controlled text instead of running them', async () => {
    const test = harness({
      interactive: true,
      ask: async () => 'n',
      afterLaunch: [
        transport({
          type: 'agent_interaction_request',
          timestamp: 1,
          interaction: { ...confirmation, message: 'rm -rf /\u001b[2K\u001b[1Gls' },
        }),
      ],
    })
    const running = runRunCli(['clean'], test.dependencies)
    await vi.waitFor(() => expect(commandOperations(test)).toContain('approval-respond'))
    await test.emit(settled('completed'))

    expect(await running).toBe(0)
    expect(test.stderr.join('')).toContain('rm -rf /\\x1b[2K\\x1b[1Gls')
    expect(test.stderr.join('')).not.toContain('\u001b')
  })
})

describe('interrupt signals', () => {
  it('counts one Ctrl-C once even when Electron also asks to quit', () => {
    const handlers: ((event: { preventDefault(): void }) => void)[] = []
    const host = {
      on: (_event: 'before-quit', handler: (event: { preventDefault(): void }) => void) => {
        handlers.push(handler)
      },
      off: () => undefined,
    }
    let time = 1_000
    const listener = vi.fn()
    const release = listenForInterrupts(listener, host, () => time)
    const preventDefault = vi.fn()

    process.emit('SIGINT')
    handlers[0]?.({ preventDefault })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalledTimes(1)

    time += 1_000
    handlers[0]?.({ preventDefault })
    expect(listener).toHaveBeenCalledTimes(2)
    release()
  })
})
