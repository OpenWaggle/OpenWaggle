import { randomUUID } from 'node:crypto'
import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import { SESSION_QUERY_CONTRACT_VERSION, type SessionQuery } from '@shared/types/session-query'
import { app } from 'electron'
import { writeCliStdout } from './cli-stdout'
import { validateCommandCliOptions } from './command-cli-option-contract'
import {
  type LocalSessionCliClientInput,
  prepareLocalSessionCliClientInput,
} from './local-session-cli-client'
import { hasFlag, type ParsedArguments, parseMcpCliArguments } from './mcp-cli-arguments'
import { SESSION_CLI_EXIT, sessionCliExitCodeForError } from './session-cli-exit-status'
import {
  executeLocalSessionCommand,
  LocalSessionHostUpgradePendingError,
  probeLocalSessionHost,
  watchLocalSessionEvents,
} from './session-host/local-session-client'
import { isLocalSessionHostUnavailable } from './session-host/local-session-host-launcher'
import { refreshLocalSessionHostEndpoint } from './session-host/local-session-paths'
import { validateSessionsCliCombinations } from './sessions-cli-option-combinations'
import { sessionsCliResponseText, writeSessionsCliError } from './sessions-cli-output'
import {
  formatStatusReport,
  type HostProbe,
  mapWithConcurrency,
  type StatusActiveRun,
  type StatusReport,
} from './status-cli-report'

export {
  formatDuration,
  formatStatusReport,
  type HostProbe,
  mapWithConcurrency,
  type StatusActiveRun,
  type StatusReport,
} from './status-cli-report'

export const STATUS_CLI_USAGE = `OpenWaggle status

Show whether the background Session Host is running and which Runs are active.
This command never starts the Session Host. If an older Host version is running, it
reports that the Host will hand over to this version once its active work ends, which
any other command would also ask it to do. Checking counts as activity, so an idle Host
waits a little longer before it exits.

Usage:
  openwaggle status [--json]
    [--profile <name> [--credential-stdin|--profile-credential-file <path>]]`

const STATUS_OPTIONS = ['json', 'profile', 'credential-stdin', 'profile-credential-file'] as const
const STATUS_BOOLEAN_OPTIONS = new Set(['json', 'credential-stdin'])
/** Session lookups run a few at a time so many active Runs cannot exhaust Host connections. */
export const STATUS_LOOKUP_CONCURRENCY = 4

type ClientInput = LocalSessionCliClientInput

export interface StatusCliDependencies {
  readonly version: () => string
  readonly now: () => number
  readonly prepareClientInput: typeof prepareLocalSessionCliClientInput
  readonly probe: (input: ClientInput) => Promise<{
    readonly hostInstanceId: string
    readonly revision: number
  }>
  readonly snapshotActiveRuns: (input: ClientInput) => Promise<readonly BackgroundRunSnapshot[]>
  readonly query: (input: ClientInput, query: SessionQuery) => Promise<LocalSessionCommandResult>
  readonly writeStdout: (text: string) => Promise<void>
}

async function snapshotActiveRuns(input: ClientInput) {
  const abort = new AbortController()
  let snapshot: readonly BackgroundRunSnapshot[] = []
  await watchLocalSessionEvents({
    ...input,
    signal: abort.signal,
    onSnapshot: (activeRuns) => {
      snapshot = activeRuns
    },
    // The first cursor marks an established subscription; its snapshot has been delivered.
    onCursor: () => abort.abort(),
    onEvent: () => undefined,
  })
  return snapshot
}

export const defaultStatusCliDependencies: StatusCliDependencies = {
  version: () => app.getVersion(),
  now: Date.now,
  prepareClientInput: prepareLocalSessionCliClientInput,
  probe: async (input) =>
    probeLocalSessionHost({ ...input, paths: await refreshLocalSessionHostEndpoint(input.paths) }),
  snapshotActiveRuns: async (input) =>
    snapshotActiveRuns({ ...input, paths: await refreshLocalSessionHostEndpoint(input.paths) }),
  query: async (input, query) =>
    executeLocalSessionCommand({
      ...input,
      paths: await refreshLocalSessionHostEndpoint(input.paths),
      payload: {
        contract: 'session-query-v2',
        request: {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: randomUUID(),
          query,
        },
      },
    }),
  writeStdout: writeCliStdout,
}

function queryOutcome(result: LocalSessionCommandResult) {
  return result.contract === 'session-query-v2' ? result.response.outcome : undefined
}

async function lookup(
  input: ClientInput,
  query: SessionQuery,
  dependencies: StatusCliDependencies,
) {
  try {
    const result = await dependencies.query(input, query)
    return queryOutcome(result)
  } catch {
    return undefined
  }
}

async function describeActiveRun(
  input: ClientInput,
  run: BackgroundRunSnapshot,
  dependencies: StatusCliDependencies,
): Promise<StatusActiveRun> {
  const [readOutcome, requestsOutcome, statusOutcome] = await Promise.all([
    lookup(input, { operation: 'read', sessionId: run.sessionId }, dependencies),
    lookup(input, { operation: 'requests-list', sessionId: run.sessionId }, dependencies),
    lookup(input, { operation: 'status', sessionId: run.sessionId }, dependencies),
  ])
  const runId =
    statusOutcome?.operation === 'status' && 'activeRunId' in statusOutcome
      ? (statusOutcome.activeRunId ?? null)
      : null
  const session =
    readOutcome && readOutcome.operation === 'read' && 'session' in readOutcome
      ? readOutcome.session
      : undefined
  const pendingQuestions =
    requestsOutcome &&
    requestsOutcome.operation === 'requests-list' &&
    'requests' in requestsOutcome
      ? requestsOutcome.requests.length
      : null
  return {
    sessionId: run.sessionId,
    runId,
    model: run.model,
    startedAt: run.startedAt,
    pendingQuestions,
    title: session?.title ?? null,
    projectPath: session?.projectPath ?? null,
  }
}

/** Ask whether a Session Host answers, without ever launching one. */
export async function probeRunningHost(
  input: ClientInput,
  probe: StatusCliDependencies['probe'],
): Promise<HostProbe> {
  try {
    const negotiation = await probe(input)
    return { state: 'running', ...negotiation }
  } catch (error) {
    if (error instanceof LocalSessionHostUpgradePendingError) {
      return {
        state: 'upgrade-pending',
        hostInstanceId: error.hostInstanceId,
        blockingRuns: error.blockingRuns.length,
      }
    }
    if (isLocalSessionHostUnavailable(error)) return { state: 'not-running' }
    throw error
  }
}

/** Probe the Session Host without launching it, then describe its active Runs. */
export async function readStatusReport(
  arguments_: ParsedArguments,
  dependencies: StatusCliDependencies = defaultStatusCliDependencies,
): Promise<StatusReport> {
  const version = dependencies.version()
  const input = await dependencies.prepareClientInput(arguments_)
  const host = await probeRunningHost(input, dependencies.probe)
  if (host.state === 'not-running') return { version, host }
  if (host.state === 'upgrade-pending') return { version, host }
  const snapshots = await dependencies.snapshotActiveRuns(input)
  const activeRuns = await mapWithConcurrency(snapshots, STATUS_LOOKUP_CONCURRENCY, (run) =>
    describeActiveRun(input, run, dependencies),
  )
  return {
    version,
    host: {
      state: 'running',
      hostInstanceId: host.hostInstanceId,
      protocolRevision: host.revision,
    },
    activeRuns: [...activeRuns].sort((left, right) => left.startedAt - right.startedAt),
  }
}

export async function runStatusCli(
  args: readonly string[],
  dependencies: StatusCliDependencies = defaultStatusCliDependencies,
) {
  const parsed = parseMcpCliArguments(args)
  const json = hasFlag(parsed, 'json')
  try {
    if ((args.length === 1 && args[0] === '-h') || parsed.options.has('help')) {
      await dependencies.writeStdout(`${STATUS_CLI_USAGE}\n`)
      return SESSION_CLI_EXIT.SUCCESS
    }
    validateCommandCliOptions({
      surface: 'OpenWaggle',
      route: 'status',
      arguments: parsed,
      optionsByRoute: { status: STATUS_OPTIONS },
      booleanOptions: STATUS_BOOLEAN_OPTIONS,
      argumentsByRoute: { status: { minimum: 0, maximum: 0 } },
    })
    validateSessionsCliCombinations('status', parsed)
    const report = await readStatusReport(parsed, dependencies)
    if (json) await dependencies.writeStdout(sessionsCliResponseText('status', report, true))
    else await dependencies.writeStdout(`${formatStatusReport(report, dependencies.now())}\n`)
    return SESSION_CLI_EXIT.SUCCESS
  } catch (error) {
    return sessionCliExitCodeForError(writeSessionsCliError(error, json))
  }
}
