import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const machineOutput = vi.hoisted(() => {
  const lines: string[] = []
  return { lines }
})

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test' } }))
vi.mock('../cli-stdout', () => ({
  cliStdoutIsTerminal: () => false,
  writeCliStdout: async (text: string) => {
    machineOutput.lines.push(text)
  },
}))
vi.mock('../local-session-cli-client', () => ({ createLocalSessionCliClientInput: vi.fn() }))
vi.mock('../session-host/local-session-client', () => ({
  executeLocalSessionCommand: vi.fn(),
  watchLocalSessionEvents: vi.fn(),
}))

const { runRunCli, RUN_CLI_INTERRUPTED_EXIT } = await import('../run-cli')
const { confirmation, harness, resetSequence, RUN, SESSION, settled, textDelta, transport } =
  await import('./run-cli-harness')
type Harness = ReturnType<typeof harness>

async function waitForLaunch(test: Harness) {
  await vi.waitFor(() =>
    expect(test.commands.some((command) => command.contract === 'session-lifecycle-v2')).toBe(true),
  )
}

describe('openwaggle run', () => {
  beforeEach(() => {
    machineOutput.lines.length = 0
    resetSequence()
  })

  it('launches in the current project, streams the reply, and exits when the Run completes', async () => {
    const test = harness({
      afterLaunch: [
        textDelta('Other session', 'other'),
        textDelta('Hello'),
        transport({
          type: 'tool_execution_start',
          timestamp: 1,
          toolCallId: 't-1',
          toolName: 'bash',
          args: { command: 'pnpm test' },
        }),
        textDelta(' world'),
        settled('completed'),
      ],
    })

    const exitCode = await runRunCli(['fix', 'the', 'tests'], test.dependencies)

    expect(exitCode).toBe(0)
    expect(test.stdout.join('')).toBe('Hello\n world\n')
    // The newline ending the partial reply line lands before the progress line.
    const toolLine = test.combined.findIndex((chunk) => chunk.startsWith('err:• bash'))
    expect(test.combined.slice(toolLine - 2, toolLine)).toEqual(['out:Hello', 'out:\n'])
    const stderr = test.stderr.join('')
    expect(stderr).toContain(`openwaggle: started Session ${SESSION}`)
    expect(stderr).toContain('• bash pnpm test')
    const launch = test.commands[0]
    expect(launch?.contract).toBe('session-lifecycle-v2')
    if (launch?.contract !== 'session-lifecycle-v2') return
    expect(launch.request.command).toMatchObject({
      operation: 'launch',
      projectPath: process.cwd(),
      objective: 'fix the tests',
    })
  })

  it('exits non-zero with the terminal status when the Run fails', async () => {
    const test = harness({ afterLaunch: [settled('failed')] })

    expect(await runRunCli(['fix'], test.dependencies)).toBe(1)
    expect(test.stderr.join('')).toContain('openwaggle: Run failed.')
  })

  it('reports a rejected launch without waiting for events', async () => {
    const test = harness({
      launchResult: fromPartial({
        contract: 'session-lifecycle-v2',
        response: {
          outcome: { operation: 'launch', effect: 'rejected', code: 'not_found', retryable: false },
        },
      }),
    })

    expect(await runRunCli(['fix'], test.dependencies)).toBe(5)
    expect(test.stdout).toEqual([])
    expect(test.stderr.join('')).toContain('the Session Host refused the launch (not_found).')
  })

  it('reports a rejected launch as single-line JSONL records', async () => {
    const test = harness({
      launchResult: fromPartial({
        contract: 'session-lifecycle-v2',
        response: {
          outcome: { operation: 'launch', effect: 'rejected', code: 'not_found', retryable: false },
        },
      }),
    })

    expect(await runRunCli(['fix', '--jsonl'], test.dependencies)).toBe(5)
    const records = test.stdout
      .join('')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(records.map((line) => line.record.kind)).toEqual(['launch-rejected', 'run-settled'])
    expect(records[1].record).toMatchObject({ exitCode: 5 })
  })

  it('answers an approval inline in an interactive terminal', async () => {
    const test = harness({
      interactive: true,
      ask: async () => 'y',
      afterLaunch: [
        transport({ type: 'agent_interaction_request', timestamp: 1, interaction: confirmation }),
      ],
    })

    const running = runRunCli(['clean'], test.dependencies)
    await vi.waitFor(() => expect(test.commands).toHaveLength(2))
    await test.emit(settled('completed'))

    expect(await running).toBe(0)
    const answer = test.commands[1]
    expect(answer?.contract).toBe('session-control-v2')
    if (answer?.contract !== 'session-control-v2') return
    expect(answer.request.command).toEqual({
      operation: 'approval-respond',
      sessionId: SESSION,
      runId: RUN,
      interactionId: 'i-1',
      kind: 'confirm',
      response: { kind: 'confirm', accepted: true },
    })
    expect(test.stderr.join('')).toContain('rm -rf build')
  })

  it('prints how to answer when the terminal is not interactive', async () => {
    const test = harness({
      afterLaunch: [
        transport({ type: 'agent_interaction_request', timestamp: 1, interaction: confirmation }),
        settled('completed'),
      ],
    })

    expect(await runRunCli(['clean'], test.dependencies)).toBe(0)
    await vi.waitFor(() =>
      expect(test.stderr.join('')).toContain(
        `openwaggle sessions requests respond ${SESSION} ${RUN} i-1 --response-json '{"kind":"confirm","accepted":true}' --approve`,
      ),
    )
  })

  it('stops asking when the question is answered elsewhere', async () => {
    const test = harness({
      interactive: true,
      ask: (_question, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
      afterLaunch: [
        transport({ type: 'agent_interaction_request', timestamp: 1, interaction: confirmation }),
      ],
    })

    const running = runRunCli(['clean'], test.dependencies)
    await waitForLaunch(test)
    await test.emit(
      transport({
        type: 'agent_interaction_resolved',
        timestamp: 2,
        runId: RUN,
        interactionId: 'i-1',
        kind: 'confirm',
        status: 'resolved',
      }),
    )
    await test.emit(settled('completed'))

    expect(await running).toBe(0)
    expect(test.commands).toHaveLength(1)
    await vi.waitFor(() =>
      expect(test.stderr.join('')).toContain('the question was answered elsewhere'),
    )
  })

  it('interrupts the Run on Ctrl-C and stops waiting on a second Ctrl-C', async () => {
    const test = harness()
    const running = runRunCli(['long', 'task'], test.dependencies)
    await waitForLaunch(test)
    await vi.waitFor(() => expect(test.stderr.join('')).toContain('started Session'))

    test.interrupt()
    await vi.waitFor(() => expect(test.commands).toHaveLength(2))
    const interrupt = test.commands[1]
    expect(interrupt?.contract === 'session-control-v2' && interrupt.request.command).toEqual({
      operation: 'interrupt',
      sessionId: SESSION,
      expectedRunId: RUN,
    })

    test.interrupt()
    expect(await running).toBe(RUN_CLI_INTERRUPTED_EXIT)
  })

  it('exits with the interrupted status when the Run is interrupted', async () => {
    const test = harness({ afterLaunch: [settled('interrupted')] })

    expect(await runRunCli(['task'], test.dependencies)).toBe(RUN_CLI_INTERRUPTED_EXIT)
  })

  it('writes versioned records in JSONL mode', async () => {
    const test = harness({ afterLaunch: [textDelta('Hi'), settled('completed')] })

    expect(await runRunCli(['task', '--jsonl'], test.dependencies)).toBe(0)
    const records = test.stdout.map((line) => JSON.parse(line))
    expect(records.every((record) => record.schemaVersion === 1 && record.type === 'record')).toBe(
      true,
    )
    expect(records.at(-1)?.record).toEqual({
      kind: 'run-settled',
      sessionId: SESSION,
      runId: RUN,
      exitCode: 0,
    })
    expect(test.stderr).toEqual([])
  })

  it('prints usage for --help without contacting the Session Host', async () => {
    const test = harness()

    expect(await runRunCli(['--help'], test.dependencies)).toBe(0)
    expect(test.stdout.join('')).toContain('Usage:\n  openwaggle run <prompt...>')
    expect(test.commands).toEqual([])
  })

  it('reports usage errors with exit status 2', async () => {
    const test = harness()
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(await runRunCli([], test.dependencies)).toBe(2)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('A prompt is required'))
    stderr.mockRestore()
  })
})
