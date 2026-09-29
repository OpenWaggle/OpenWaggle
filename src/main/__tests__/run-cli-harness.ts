import type { AgentLoopConfirmInteraction } from '@shared/types/agent-loop-interaction'
import { SessionId } from '@shared/types/brand'
import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import type {
  SessionHostEventEnvelope,
  SessionHostEventPayload,
  SessionRunTerminalStatus,
} from '@shared/types/session-host-event'
import type { AgentTransportEvent } from '@shared/types/stream'
import { fromPartial } from '@total-typescript/shoehorn'
import type { RunCliDependencies } from '../run-cli'
import type { LocalSessionWatchResult } from '../session-host/local-session-event-client'

type WatchInput = Parameters<RunCliDependencies['watch']>[0]

export const SESSION = 's-1'
export const RUN = 'r-1'
let sequence = 0

export function resetSequence() {
  sequence = 0
}

export function envelope(payload: SessionHostEventPayload): SessionHostEventEnvelope {
  sequence += 1
  return { cursor: { hostInstanceId: 'host', sequence }, timestamp: sequence, payload }
}

export function transport(event: AgentTransportEvent, sessionId = SESSION) {
  return envelope({ kind: 'session-transport', sessionId, event })
}

export function textDelta(delta: string, sessionId = SESSION) {
  return transport(
    {
      type: 'message_update',
      timestamp: 1,
      messageId: 'm-1',
      role: 'assistant',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta },
    },
    sessionId,
  )
}

export function settled(
  terminalStatus?: SessionRunTerminalStatus,
  operation: 'run-settled' | 'follow-up-started' = 'run-settled',
) {
  return envelope({
    kind: 'session-state-changed',
    sessionId: SESSION,
    stateRevision: 2,
    operation,
    runId: RUN,
    ...(terminalStatus ? { terminalStatus } : {}),
  })
}

export function stateChanged(operation: string) {
  return envelope({
    kind: 'session-state-changed',
    sessionId: SESSION,
    stateRevision: 3,
    operation,
  })
}

export const confirmation: AgentLoopConfirmInteraction = {
  interactionId: 'i-1',
  sessionId: SessionId(SESSION),
  runId: RUN,
  kind: 'confirm',
  source: 'pi-ui',
  createdAt: 1,
  title: 'Run bash?',
  message: 'rm -rf build',
  purpose: 'authorization',
}

export function launchedResult(replayed = false): LocalSessionCommandResult {
  return fromPartial({
    contract: 'session-lifecycle-v2',
    response: {
      replayed,
      outcome: {
        operation: 'launch',
        effect: 'launched-root',
        sessionId: SESSION,
        runId: RUN,
        workspaceId: 'w-1',
      },
    },
  })
}

const accepted: LocalSessionCommandResult = fromPartial({
  contract: 'session-control-v2',
  response: { outcome: { effect: 'interaction-resolved' } },
})

function turnsResult(turns: readonly { readonly runId: string; readonly status: string }[]) {
  return fromPartial<LocalSessionCommandResult>({
    contract: 'session-query-v2',
    response: { outcome: { operation: 'turns', sessionId: SESSION, turns } },
  })
}

export interface Harness {
  readonly dependencies: RunCliDependencies
  readonly stdout: string[]
  readonly stderr: string[]
  /** Both streams in the order they were written, prefixed with `out:` or `err:`. */
  readonly combined: string[]
  readonly commands: LocalSessionCommandPayload[]
  /** Deliver an event through the active subscription. */
  emit(event: SessionHostEventEnvelope): Promise<void>
  /** End the active subscription the way the Host would. */
  endWatch(result: LocalSessionWatchResult): void
  failWatch(error: Error): void
  interrupt(): void
}

export interface HarnessOptions {
  readonly beforeLaunch?: readonly SessionHostEventEnvelope[]
  readonly afterLaunch?: readonly SessionHostEventEnvelope[]
  readonly launchResult?: LocalSessionCommandResult
  readonly interactive?: boolean
  readonly ask?: RunCliDependencies['ask']
  /** What a `turns` query reports for the Session's recent Runs. */
  readonly turns?: readonly { readonly runId: string; readonly status: string }[]
  readonly createClientInput?: RunCliDependencies['createClientInput']
  readonly writeStdout?: RunCliDependencies['writeStdout']
}

export function harness(options: HarnessOptions = {}): Harness {
  const stdout: string[] = []
  const stderr: string[] = []
  const combined: string[] = []
  const commands: LocalSessionCommandPayload[] = []
  let watchInput: WatchInput | null = null
  let settleWatch: (result: LocalSessionWatchResult) => void = () => undefined
  let rejectWatch: (error: Error) => void = () => undefined
  let interruptListener: () => void = () => undefined
  const emit = async (event: SessionHostEventEnvelope) => {
    if (!watchInput) throw new Error('No active subscription.')
    await watchInput.onEvent(event)
  }
  const dependencies: RunCliDependencies = {
    createClientInput:
      options.createClientInput ?? (async () => fromPartial({ clientVersion: 'test' })),
    resolveMessageInput: async (_command, arguments_) => ({ arguments: arguments_ }),
    execute: async (input) => {
      commands.push(input.payload)
      if (input.payload.contract === 'session-lifecycle-v2') {
        for (const event of options.afterLaunch ?? []) await emit(event)
        return options.launchResult ?? launchedResult()
      }
      if (input.payload.contract === 'session-query-v2') {
        return turnsResult(options.turns ?? [{ runId: RUN, status: 'active' }])
      }
      return accepted
    },
    watch: (input) => {
      watchInput = input
      return new Promise((resolve, reject) => {
        settleWatch = resolve
        rejectWatch = reject
        input.signal?.addEventListener('abort', () => resolve({ status: 'closed' }), {
          once: true,
        })
        void Promise.resolve(input.onCursor?.({ hostInstanceId: 'host', sequence: 0 })).then(
          async () => {
            for (const event of options.beforeLaunch ?? []) await input.onEvent(event)
          },
        )
      })
    },
    writeStdout:
      options.writeStdout ??
      (async (text) => {
        stdout.push(text)
        combined.push(`out:${text}`)
      }),
    writeStderr: (text) => {
      stderr.push(text)
      combined.push(`err:${text}`)
    },
    stdoutIsTerminal: false,
    interactive: options.interactive ?? false,
    ask: options.ask ?? (async () => 'n'),
    onInterrupt: (listener) => {
      interruptListener = listener
      return () => undefined
    },
  }
  return {
    dependencies,
    stdout,
    stderr,
    combined,
    commands,
    emit,
    endWatch: (result) => settleWatch(result),
    failWatch: (error) => rejectWatch(error),
    interrupt: () => interruptListener(),
  }
}
