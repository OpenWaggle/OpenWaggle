import { LOCAL_HOST_CONTRACT_VERSION } from '@shared/types/local-host'
import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import { writeCliStdout } from './cli-stdout'
import { validateCommandCliOptions } from './command-cli-option-contract'
import { env } from './env'
import {
  cancelUpdateOnInterrupt,
  defaultCliHostUpdateStopDependencies,
  formatHostUpdateStopReport,
  type HostUpdateStopDependencies,
  type HostUpdateStopReport,
  stopSessionHostForUpdate,
} from './host-update-stop'
import type { LocalSessionCliClientInput } from './local-session-cli-client'
import { hasFlag, option, type ParsedArguments, parseMcpCliArguments } from './mcp-cli-arguments'
import { SESSION_CLI_EXIT, sessionCliExitCodeForError } from './session-cli-exit-status'
import { executeLocalSessionCommand } from './session-host/local-session-client'
import { refreshLocalSessionHostEndpoint } from './session-host/local-session-paths'
import { positiveInteger } from './sessions-cli-arguments'
import { sessionsCliResponseText, writeSessionsCliError } from './sessions-cli-output'
import {
  defaultStatusCliDependencies,
  type HostProbe,
  probeRunningHost,
  runStatusCli,
  type StatusCliDependencies,
} from './status-cli'

export const HOST_CLI_USAGE = `OpenWaggle Session Host

The Session Host is the background process that owns Sessions and agent Runs. It starts
on demand and exits on its own a few minutes after its last work ends.

Usage:
  openwaggle host status [--json]
  openwaggle host stop [--wait [--timeout-ms <ms>]] [--json]
  openwaggle host stop --update [--json]

'host status' is the same as 'openwaggle status'.

'host stop' refuses new requests at once and lets active Runs, including the Follow-ups
already queued behind them, finish before the Host exits.
With --wait it returns only once the Host has exited (default timeout: 2 minutes).
If the desktop app is open it starts a new Host when it next needs one.

'host stop --update' is the stop that installing an update uses. If agent Runs are active it
asks whether to wait for them, stop them now, or cancel. Then the Host gets 10 seconds to finish
its work, interrupts any Run still active, and exits; the command returns once its process is
gone. It does nothing while the desktop app is open, because the app stops its own Host when it
installs an update.

Only the local user can stop the Host; access profiles cannot.

Options:
  -h, --help`

const STOP_OPTIONS = ['wait', 'timeout-ms', 'json', 'update'] as const
const BOOLEAN_OPTIONS = new Set(['wait', 'json', 'update'])
export const HOST_STOP_DEFAULT_TIMEOUT_MS = 120_000
const HOST_STOP_POLL_INTERVAL_MS = 250

type ClientInput = LocalSessionCliClientInput

export interface HostCliDependencies {
  readonly status: StatusCliDependencies
  readonly updateStop: (client: ClientInput) => HostUpdateStopDependencies
  readonly execute: (
    input: ClientInput & {
      readonly payload: Parameters<typeof executeLocalSessionCommand>[0]['payload']
    },
  ) => Promise<LocalSessionCommandResult>
  readonly now: () => number
  readonly wait: (milliseconds: number) => Promise<void>
  readonly writeStdout: (text: string) => Promise<void>
}

const defaultDependencies: HostCliDependencies = {
  status: defaultStatusCliDependencies,
  updateStop: defaultCliHostUpdateStopDependencies,
  execute: async (input) =>
    executeLocalSessionCommand({
      ...input,
      paths: await refreshLocalSessionHostEndpoint(input.paths),
    }),
  now: Date.now,
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  writeStdout: writeCliStdout,
}

export type HostStopReport =
  | { readonly state: 'not-running' }
  | {
      readonly state: 'upgrade-pending'
      readonly hostInstanceId: string
      readonly blockingRuns: number
    }
  | {
      readonly state: 'stopping' | 'stopped' | 'replaced' | 'timed-out'
      readonly hostInstanceId: string
      readonly blockingRuns: number | null
      readonly blockingActions: number
    }

function isHelp(args: readonly string[], parsed: ParsedArguments) {
  return (
    (args.length === 1 && (args[0] === '-h' || args[0] === 'help')) || parsed.options.has('help')
  )
}

async function requestStop(input: ClientInput, dependencies: HostCliDependencies) {
  const result = await dependencies.execute({
    ...input,
    payload: {
      contract: 'local-host-v1',
      request: { contractVersion: LOCAL_HOST_CONTRACT_VERSION, operation: 'stop' },
    },
  })
  if (result.contract !== 'local-host-v1') {
    throw new Error('The Session Host returned an unexpected response to stop.')
  }
  return result.response
}

/** Poll until the stopped Host no longer answers, or another Host has taken its place. */
async function waitForExit(
  input: ClientInput,
  hostInstanceId: string,
  timeoutMs: number,
  dependencies: HostCliDependencies,
): Promise<'stopped' | 'replaced' | 'timed-out'> {
  const deadline = dependencies.now() + timeoutMs
  while (dependencies.now() < deadline) {
    // While it shuts down the Host refuses even new connections; that is progress, not failure.
    const probe: HostProbe | null = await probeRunningHost(input, dependencies.status.probe).catch(
      () => null,
    )
    if (probe?.state === 'not-running') return 'stopped'
    if (probe?.state === 'running' && probe.hostInstanceId !== hostInstanceId) return 'replaced'
    await dependencies.wait(HOST_STOP_POLL_INTERVAL_MS)
  }
  return 'timed-out'
}

/** How long `--wait` waits, or `undefined` without `--wait`. Checked before the Host is asked. */
function waitTimeout(parsed: ParsedArguments) {
  if (!hasFlag(parsed, 'wait')) {
    if (parsed.options.has('timeout-ms'))
      throw new Error('--wait must be given to use --timeout-ms.')
    return undefined
  }
  const timeoutMs = option(parsed, 'timeout-ms')
  return timeoutMs ? positiveInteger(timeoutMs, '--timeout-ms') : HOST_STOP_DEFAULT_TIMEOUT_MS
}

export async function stopHost(
  parsed: ParsedArguments,
  dependencies: HostCliDependencies = defaultDependencies,
  profile: string | undefined = env.OPENWAGGLE_PROFILE,
): Promise<HostStopReport> {
  const timeoutMs = waitTimeout(parsed)
  if (profile) {
    throw new Error(
      "'host stop' requires the local user's authorization and cannot use an access profile. Unset OPENWAGGLE_PROFILE and try again.",
    )
  }
  const input = await dependencies.status.prepareClientInput(parsed)
  const probe = await probeRunningHost(input, dependencies.status.probe)
  if (probe.state === 'not-running') return { state: 'not-running' }
  if (probe.state === 'upgrade-pending') {
    // An older Host has no stop command, but it is already handing over once it is idle.
    const pending = { hostInstanceId: probe.hostInstanceId, blockingRuns: probe.blockingRuns }
    if (timeoutMs === undefined) return { state: 'upgrade-pending', ...pending }
    const state = await waitForExit(input, probe.hostInstanceId, timeoutMs, dependencies)
    return { state, ...pending, blockingActions: 0 }
  }
  const response = await requestStop(input, dependencies)
  const stopping = {
    hostInstanceId: response.hostInstanceId,
    blockingRuns: response.blockingRuns,
    blockingActions: response.blockingActions,
  }
  if (timeoutMs === undefined) return { state: 'stopping', ...stopping }
  const outcome = await waitForExit(input, response.hostInstanceId, timeoutMs, dependencies)
  return { state: outcome, ...stopping }
}

/** What the Host still waits for, or `undefined` when nothing holds it. */
function waitsForPhrase(blockingRuns: number | null, blockingActions: number) {
  if (blockingRuns === null) {
    const actions = blockingActions > 0 ? ' and running Actions' : ''
    return `its active Runs${actions}, if any, finish`
  }
  const parts = [
    blockingRuns > 0
      ? blockingRuns === 1
        ? 'its active Run'
        : `its ${blockingRuns} active Runs`
      : undefined,
    blockingActions > 0
      ? blockingActions === 1
        ? 'a running Action'
        : `${blockingActions} running Actions`
      : undefined,
  ].filter((part) => part !== undefined)
  if (parts.length === 0) return undefined
  const single = blockingRuns + blockingActions === 1
  return `${parts.join(' and ')} ${single ? 'finishes' : 'finish'}`
}

const SOONER_HINT =
  "To stop it sooner, pause queued Follow-ups with 'openwaggle sessions queue pause <session-id> --queue-revision <n>', interrupt Runs with 'openwaggle sessions interrupt <session-id> --expected-run <run-id>', and stop Actions in the desktop app."

const SETTLED_STOP_MESSAGES = {
  stopped: 'Session Host stopped.',
  replaced: 'Session Host stopped; another client has already started a new one.',
  'timed-out': 'Session Host is still stopping; its active work has not finished yet.',
} as const

export function formatHostStopReport(report: HostStopReport) {
  if (report.state === 'not-running') return 'Session Host is not running.'
  if (report.state === 'upgrade-pending') {
    const waitsFor = waitsForPhrase(report.blockingRuns, 0)
    return `An older Session Host is running and hands over to this version once ${waitsFor ?? 'it is idle'}.`
  }
  const waitsFor = waitsForPhrase(report.blockingRuns, report.blockingActions)
  if (report.state === 'stopping') {
    return waitsFor
      ? `Session Host refuses new requests and stops once ${waitsFor}.\n${SOONER_HINT}`
      : 'Session Host is stopping.'
  }
  if (report.state === 'timed-out' && waitsFor) {
    return `${SETTLED_STOP_MESSAGES[report.state]}\n${SOONER_HINT}`
  }
  return SETTLED_STOP_MESSAGES[report.state]
}

/** `host stop --update`: the stop `openwaggle update` and the install script use (ADR 0047). */
export async function stopHostForUpdate(
  parsed: ParsedArguments,
  dependencies: HostCliDependencies = defaultDependencies,
  profile: string | undefined = env.OPENWAGGLE_PROFILE,
): Promise<HostUpdateStopReport> {
  if (parsed.options.has('wait') || parsed.options.has('timeout-ms')) {
    throw new Error(
      '--update does not accept --wait or --timeout-ms; it always waits for the Host to exit.',
    )
  }
  if (profile) {
    throw new Error(
      "'host stop' requires the local user's authorization and cannot use an access profile. Unset OPENWAGGLE_PROFILE and try again.",
    )
  }
  const client = await dependencies.status.prepareClientInput(parsed)
  return cancelUpdateOnInterrupt(() => stopSessionHostForUpdate(dependencies.updateStop(client)))
}

async function runHostUpdateStop(
  parsed: ParsedArguments,
  json: boolean,
  dependencies: HostCliDependencies,
) {
  const report = await stopHostForUpdate(parsed, dependencies)
  await dependencies.writeStdout(
    json
      ? sessionsCliResponseText('host-stop', report, true)
      : `${formatHostUpdateStopReport(report)}\n`,
  )
  if (report.state === 'timed-out') return SESSION_CLI_EXIT.TIMEOUT
  if (
    report.state === 'cancelled' ||
    report.state === 'desktop-open' ||
    report.state === 'replaced'
  ) {
    return SESSION_CLI_EXIT.CONFLICT
  }
  return report.state === 'refused' ? SESSION_CLI_EXIT.FAILURE : SESSION_CLI_EXIT.SUCCESS
}

async function runHostStop(args: readonly string[], dependencies: HostCliDependencies) {
  const parsed = parseMcpCliArguments(args)
  const json = hasFlag(parsed, 'json')
  try {
    validateCommandCliOptions({
      surface: 'OpenWaggle host',
      route: 'stop',
      arguments: parsed,
      optionsByRoute: { stop: STOP_OPTIONS },
      booleanOptions: BOOLEAN_OPTIONS,
      argumentsByRoute: { stop: { minimum: 0, maximum: 0 } },
    })
    if (hasFlag(parsed, 'update')) return await runHostUpdateStop(parsed, json, dependencies)
    const report = await stopHost(parsed, dependencies)
    await dependencies.writeStdout(
      json
        ? sessionsCliResponseText('host-stop', report, true)
        : `${formatHostStopReport(report)}\n`,
    )
    return report.state === 'timed-out' ? SESSION_CLI_EXIT.TIMEOUT : SESSION_CLI_EXIT.SUCCESS
  } catch (error) {
    return sessionCliExitCodeForError(writeSessionsCliError(error, json))
  }
}

export async function runHostCli(
  args: readonly string[],
  dependencies: HostCliDependencies = defaultDependencies,
) {
  const [command, ...rest] = args
  // `host status` is the status command, including its own --help.
  if (command === 'status') return runStatusCli(rest, dependencies.status)
  const parsed = parseMcpCliArguments(args)
  if (command === undefined || isHelp(args, parsed)) {
    await dependencies.writeStdout(`${HOST_CLI_USAGE}\n`)
    return SESSION_CLI_EXIT.SUCCESS
  }
  if (command === 'stop') return runHostStop(rest, dependencies)
  return sessionCliExitCodeForError(
    writeSessionsCliError(
      new Error(`Unsupported OpenWaggle host command: ${command}. Expected status or stop.`),
      false,
    ),
  )
}
