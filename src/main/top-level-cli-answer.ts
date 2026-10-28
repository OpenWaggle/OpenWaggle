import { CLI_EXIT } from './cli-error'
import { SESSIONS_CLI_OUTPUT_SCHEMA_VERSION } from './cli-output-schema'
import type { TopLevelCliRoute } from './top-level-cli-route'
import { topLevelCliUsage } from './top-level-cli-usage'

/** What an invocation answered without the Session Host or the desktop app prints. */
export interface TopLevelCliAnswer {
  readonly stream: 'stdout' | 'stderr'
  readonly text: string
  readonly exitCode: number
}

/**
 * The output of `help`, `version` and usage errors, or `null` for a route that does more. Both
 * the main bundle (top-level-cli-entry.ts) and the boot shim (boot-top-level-cli.ts) print it,
 * so the answer is the same whichever process gives it.
 */
export function topLevelCliAnswer(
  route: TopLevelCliRoute,
  version: string,
): TopLevelCliAnswer | null {
  if (route.kind === 'help') {
    return { stream: 'stdout', text: `${topLevelCliUsage(version)}\n`, exitCode: CLI_EXIT.SUCCESS }
  }
  if (route.kind === 'version') {
    return { stream: 'stdout', text: `${version}\n`, exitCode: CLI_EXIT.SUCCESS }
  }
  if (route.kind !== 'usage-error') return null
  const text =
    'machine' in route && route.machine
      ? `${JSON.stringify({
          schemaVersion: SESSIONS_CLI_OUTPUT_SCHEMA_VERSION,
          type: 'error',
          error: { kind: 'usage', message: route.message },
        })}\n`
      : `openwaggle: ${route.message}\n\n${topLevelCliUsage(version)}\n`
  return { stream: 'stderr', text, exitCode: CLI_EXIT.USAGE }
}
