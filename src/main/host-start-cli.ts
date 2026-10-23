import { validateCommandCliOptions } from './command-cli-option-contract'
import {
  createLocalSessionCliClientInput,
  type LocalSessionCliClientInput,
} from './local-session-cli-client'
import { hasFlag, type ParsedArguments, parseMcpCliArguments } from './mcp-cli-arguments'
import { SESSION_CLI_EXIT, sessionCliExitCodeForError } from './session-cli-exit-status'
import { sessionsCliResponseText, writeSessionsCliError } from './sessions-cli-output'
import { probeRunningHost, type StatusCliDependencies } from './status-cli'

export interface HostStartDependencies {
  /** Starts the Host when it is not running and resolves the client that reaches it. */
  readonly start?: (arguments_: ParsedArguments) => Promise<LocalSessionCliClientInput>
  readonly status: Pick<StatusCliDependencies, 'probe'>
  readonly writeStdout: (text: string) => Promise<void>
}

/**
 * `openwaggle host start`: starts the Session Host without a window, if it is not running, and
 * returns. Background start runs it at login so Scheduled tasks keep firing (ADR 0057).
 */
export async function runHostStart(args: readonly string[], dependencies: HostStartDependencies) {
  const parsed = parseMcpCliArguments(args)
  const json = hasFlag(parsed, 'json')
  try {
    validateCommandCliOptions({
      surface: 'OpenWaggle host',
      route: 'start',
      arguments: parsed,
      optionsByRoute: { start: ['json'] },
      booleanOptions: new Set(['json']),
      argumentsByRoute: { start: { minimum: 0, maximum: 0 } },
    })
    const client = await (dependencies.start ?? createLocalSessionCliClientInput)(parsed)
    const probe = await probeRunningHost(client, dependencies.status.probe)
    const report =
      probe.state === 'running'
        ? { state: 'running' as const, hostInstanceId: probe.hostInstanceId }
        : probe
    await dependencies.writeStdout(
      json
        ? sessionsCliResponseText('host-start', report, true)
        : `Session Host: ${report.state === 'running' ? 'running' : report.state}\n`,
    )
    return report.state === 'running' ? SESSION_CLI_EXIT.SUCCESS : SESSION_CLI_EXIT.HOST_UNAVAILABLE
  } catch (error) {
    return sessionCliExitCodeForError(writeSessionsCliError(error, json))
  }
}
