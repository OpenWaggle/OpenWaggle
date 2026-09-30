import { createInterface } from 'node:readline/promises'
import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import { app } from 'electron'
import { cliStdoutIsTerminal, writeCliStdout } from './cli-stdout'
import { createLocalSessionCliClientInput } from './local-session-cli-client'
import { hasFlag } from './mcp-cli-arguments'
import { parseRunCliArguments, RUN_CLI_USAGE, type RunCliInvocation } from './run-cli-arguments'
import { PromptInterruptedError } from './run-cli-interactions'
import { withTimeout } from './run-cli-output'
import { RunCliSession, type RunCliSessionDependencies } from './run-cli-session'
import {
  RUN_CLI_INTERRUPTED_EXIT,
  type RunSettlement,
  settlementForWatchEnd,
} from './run-cli-settlement'
import {
  SESSION_CLI_EXIT,
  sessionCliExitCodeForError,
  sessionCliResultErrorKind,
} from './session-cli-exit-status'
import {
  executeLocalSessionCommand,
  watchLocalSessionEvents,
} from './session-host/local-session-client'
import { refreshLocalSessionHostEndpoint } from './session-host/local-session-paths'
import { resolveSessionsCliMessageInput } from './sessions-cli-message-input'
import { sessionsCliStreamRecordLine, writeSessionsCliError } from './sessions-cli-output'
import { buildSessionsCliPayload } from './sessions-cli-payload'

export { RUN_CLI_INTERRUPTED_EXIT } from './run-cli-settlement'

/** One Ctrl-C can arrive both as a signal and as Electron's quit request. */
const DUPLICATE_INTERRUPT_WINDOW_MS = 250
/** How long a second Ctrl-C waits for the first interrupt to reach the Session Host. */
export const RUN_CLI_INTERRUPT_DELIVERY_TIMEOUT_MS = 3_000
const INTERRUPTED_BEFORE_LAUNCH = 'interrupted before the Run started; nothing was launched.'
/** How long queued output may take to drain once the command has decided to exit. */
const RUN_CLI_FINAL_FLUSH_TIMEOUT_MS = 2_000

export interface RunCliDependencies extends RunCliSessionDependencies {
  readonly createClientInput: typeof createLocalSessionCliClientInput
  readonly resolveMessageInput: typeof resolveSessionsCliMessageInput
  readonly onInterrupt: (listener: () => void) => () => void
}

async function askFromTerminal(question: string, signal: AbortSignal) {
  const terminal = createInterface({ input: process.stdin, output: process.stderr })
  // In raw mode Ctrl-C reaches readline as a keypress instead of a process signal.
  const interrupted = new Promise<never>((_resolve, reject) => {
    terminal.once('SIGINT', () => reject(new PromptInterruptedError()))
  })
  const answer = terminal.question(question, { signal })
  answer.catch(() => undefined)
  try {
    return await Promise.race([answer, interrupted])
  } finally {
    terminal.close()
  }
}

export function listenForInterrupts(
  listener: () => void,
  host: {
    readonly on: (
      event: 'before-quit',
      handler: (event: { preventDefault(): void }) => void,
    ) => void
    readonly off: (
      event: 'before-quit',
      handler: (event: { preventDefault(): void }) => void,
    ) => void
  } = app,
  now: () => number = Date.now,
) {
  let lastInterruptAt = Number.NEGATIVE_INFINITY
  const notify = () => {
    const current = now()
    if (current - lastInterruptAt < DUPLICATE_INTERRUPT_WINDOW_MS) return
    lastInterruptAt = current
    listener()
  }
  // Electron turns SIGINT and SIGTERM into an app quit. Hold the quit so Ctrl-C interrupts the
  // Run instead; the command still exits through app.exit(), which skips quit events.
  const holdQuit = (event: { preventDefault(): void }) => {
    event.preventDefault()
    notify()
  }
  process.on('SIGINT', notify)
  process.on('SIGTERM', notify)
  host.on('before-quit', holdQuit)
  return () => {
    process.off('SIGINT', notify)
    process.off('SIGTERM', notify)
    host.off('before-quit', holdQuit)
  }
}

const defaultDependencies: RunCliDependencies = {
  createClientInput: createLocalSessionCliClientInput,
  resolveMessageInput: resolveSessionsCliMessageInput,
  // Windows rotates the Host endpoint on restart, so every later command re-reads it.
  execute: async (input) =>
    executeLocalSessionCommand({
      ...input,
      paths: await refreshLocalSessionHostEndpoint(input.paths),
    }),
  watch: watchLocalSessionEvents,
  writeStdout: writeCliStdout,
  writeStderr: (text) => {
    process.stderr.write(text)
  },
  get stdoutIsTerminal() {
    return cliStdoutIsTerminal()
  },
  interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
  ask: askFromTerminal,
  onInterrupt: (listener) => listenForInterrupts(listener),
}

type RunInvocation = Extract<RunCliInvocation, { readonly kind: 'run' }>

function launchedRoot(result: LocalSessionCommandResult) {
  if (result.contract !== 'session-lifecycle-v2') return undefined
  const outcome = result.response.outcome
  return outcome.effect === 'launched-root'
    ? { ...outcome, replayed: result.response.replayed }
    : undefined
}

async function launchPayload(invocation: RunInvocation, dependencies: RunCliDependencies) {
  const resolved = await dependencies.resolveMessageInput('launch', invocation.launchArguments)
  const payload = resolved.payload ?? buildSessionsCliPayload('launch', resolved.arguments)
  if (
    payload.contract !== 'session-lifecycle-v2' ||
    payload.request.command.operation !== 'launch'
  ) {
    throw new Error('openwaggle run could not build a launch request.')
  }
  return {
    payload,
    arguments: resolved.arguments,
    projectPath: payload.request.command.projectPath,
  }
}

function rejectionCode(result: LocalSessionCommandResult) {
  if (result.contract !== 'session-lifecycle-v2') return 'unexpected_response'
  const outcome = result.response.outcome
  return outcome.effect === 'rejected' ? outcome.code : 'unexpected_response'
}

/** Report a refused launch on stderr, or as records on stdout, never as if it were a reply. */
function rejectedLaunch(
  session: RunCliSession,
  result: LocalSessionCommandResult,
  errorKind: ReturnType<typeof sessionCliResultErrorKind>,
  jsonl: boolean,
): RunSettlement {
  if (jsonl) session.output.stdout(sessionsCliStreamRecordLine({ kind: 'launch-rejected', result }))
  return {
    exitCode: errorKind ? sessionCliExitCodeForError(errorKind) : SESSION_CLI_EXIT.FAILURE,
    message: `the Session Host refused the launch (${rejectionCode(result)}).`,
  }
}

/** A consumed stdin cannot also answer questions, even when it was a terminal. */
function canAskQuestions(invocation: RunInvocation, dependencies: RunCliDependencies) {
  const args = invocation.launchArguments
  return dependencies.interactive && !hasFlag(args, 'stdin') && !hasFlag(args, 'credential-stdin')
}

async function streamRun(
  session: RunCliSession,
  launch: Awaited<ReturnType<typeof launchPayload>>,
  input: {
    readonly dependencies: RunCliDependencies
    readonly jsonl: boolean
    readonly interrupted: Promise<null>
    /** Whether the launch has gone out; before that, Ctrl-C cancels instead of interrupting. */
    readonly launch: { sent: boolean; cancelled: boolean }
  },
  clientInput: Awaited<ReturnType<RunCliDependencies['createClientInput']>>,
) {
  let markSubscribed: () => void = () => undefined
  const subscribed = new Promise<null>((resolve) => {
    markSubscribed = () => resolve(null)
  })
  // Subscribe before launching so no event of the new Run can be missed.
  const watching = session.watch(() => markSubscribed())
  const watchEnded = watching.then(
    (result) => ({ kind: 'ended' as const, result }),
    (error: unknown) => ({ kind: 'failed' as const, error }),
  )
  const cancelled = input.interrupted.then(() => ({ kind: 'cancelled' as const }))
  const beforeLaunch = await Promise.race([subscribed, watchEnded, cancelled])
  if (beforeLaunch?.kind === 'cancelled' || input.launch.cancelled) {
    return { exitCode: RUN_CLI_INTERRUPTED_EXIT, message: INTERRUPTED_BEFORE_LAUNCH }
  }
  if (beforeLaunch?.kind === 'failed') throw beforeLaunch.error
  if (beforeLaunch) {
    return {
      exitCode: SESSION_CLI_EXIT.HOST_UNAVAILABLE,
      message:
        'the Session Host closed the event stream before the launch was sent; nothing was started.',
    }
  }

  input.launch.sent = true
  const result = await input.dependencies.execute({ ...clientInput, payload: launch.payload })
  const launched = launchedRoot(result)
  const errorKind = sessionCliResultErrorKind(result)
  if (!launched || errorKind) return rejectedLaunch(session, result, errorKind, input.jsonl)
  const target = { sessionId: launched.sessionId, runId: launched.runId }
  session.begin(target, { projectPath: launch.projectPath, replayed: launched.replayed })
  const ended = watchEnded.then(async (outcome): Promise<RunSettlement> => {
    const fromTerminalEvent = session.settlementFromTerminalEvent()
    if (fromTerminalEvent) return fromTerminalEvent
    if (outcome.kind === 'failed') {
      return {
        exitCode: SESSION_CLI_EXIT.HOST_UNAVAILABLE,
        message: `lost the Session Host connection: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`,
      }
    }
    // The stream is gone, but the Run's durable status may still say how it ended.
    if (!session.hasSettled()) await session.reconcile()
    return settlementForWatchEnd(outcome.result, target)
  })
  return Promise.race([session.settlement, ended])
}

async function interruptedBeforeLaunch(jsonl: boolean, dependencies: RunCliDependencies) {
  const message = INTERRUPTED_BEFORE_LAUNCH
  if (jsonl) {
    await dependencies.writeStdout(
      sessionsCliStreamRecordLine({
        kind: 'run-settled',
        exitCode: RUN_CLI_INTERRUPTED_EXIT,
        message,
      }),
    )
  } else {
    dependencies.writeStderr(`openwaggle: ${message}\n`)
  }
  return RUN_CLI_INTERRUPTED_EXIT
}

async function launchAndStream(invocation: RunInvocation, dependencies: RunCliDependencies) {
  let session: RunCliSession | null = null
  let interruptedEarly: () => void = () => undefined
  const earlyInterrupt = new Promise<null>((resolve) => {
    interruptedEarly = () => resolve(null)
  })
  const launchState = { sent: false, cancelled: false }
  const releaseInterrupts = dependencies.onInterrupt(() => {
    // Until the launch is sent, Ctrl-C cancels it; afterwards it interrupts the Run.
    if (launchState.sent) {
      session?.requestInterrupt()
      return
    }
    launchState.cancelled = true
    interruptedEarly()
  })
  try {
    // Reading the prompt from stdin and starting the Session Host can both take a while;
    // Ctrl-C during either cancels before any Run exists.
    const launch = await Promise.race([launchPayload(invocation, dependencies), earlyInterrupt])
    const clientInput = launch
      ? await Promise.race([dependencies.createClientInput(launch.arguments), earlyInterrupt])
      : null
    if (!launch || !clientInput) return interruptedBeforeLaunch(invocation.jsonl, dependencies)
    const activeSession = new RunCliSession(clientInput, invocation.jsonl, {
      ...dependencies,
      interactive: canAskQuestions(invocation, dependencies),
    })
    session = activeSession
    try {
      const settlement = await streamRun(
        activeSession,
        launch,
        { dependencies, jsonl: invocation.jsonl, interrupted: earlyInterrupt, launch: launchState },
        clientInput,
      )
      activeSession.stopWatching()
      await activeSession.interruptDelivered(RUN_CLI_INTERRUPT_DELIVERY_TIMEOUT_MS)
      activeSession.finish(settlement)
      return settlement.exitCode
    } finally {
      activeSession.stopWatching()
      // A blocked stdout pipe must not hold the command open after it has decided to exit.
      await withTimeout(activeSession.output.flushed(), RUN_CLI_FINAL_FLUSH_TIMEOUT_MS)
    }
  } finally {
    releaseInterrupts()
  }
}

export async function runRunCli(
  args: readonly string[],
  dependencies: RunCliDependencies = defaultDependencies,
) {
  let jsonl = false
  try {
    const invocation = parseRunCliArguments(args)
    if (invocation.kind === 'help') {
      await dependencies.writeStdout(`${RUN_CLI_USAGE}\n`)
      return SESSION_CLI_EXIT.SUCCESS
    }
    jsonl = invocation.jsonl
    return await launchAndStream(invocation, dependencies)
  } catch (error) {
    return sessionCliExitCodeForError(writeSessionsCliError(error, jsonl))
  }
}
