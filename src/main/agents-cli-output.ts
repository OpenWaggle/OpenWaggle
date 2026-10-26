import {
  SESSIONS_CLI_OUTPUT_SCHEMA_VERSION,
  sessionsCliResponseText,
  writeSessionsCliError,
} from './sessions-cli-output'

const JSON_INDENT_SPACES = 2
export const AGENTS_CLI_OUTPUT_SCHEMA_VERSION = SESSIONS_CLI_OUTPUT_SCHEMA_VERSION

export interface CompactAgentCatalogItem {
  readonly name: string
  readonly scope: string
  readonly description: string
  readonly valid: boolean
  readonly sourcePath: string
  readonly diagnostic?: string
}

/** The Hive CLI envelope, `{schemaVersion, type: "response", command, result}` (#351). */
export function writeAgentsCliResult(
  command: string,
  value: unknown,
  json: boolean,
  stdout: (value: string) => void | Promise<void>,
) {
  if (json) return stdout(sessionsCliResponseText(`agents ${command}`, value, true))
  return stdout(`${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`)
}

export function writeAgentsCliError(
  error: unknown,
  json: boolean,
  stderr: (value: string) => void,
) {
  return writeSessionsCliError(error, json, stderr)
}

export function writeAgentsCliCatalog(
  value: readonly CompactAgentCatalogItem[],
  json: boolean,
  stdout: (value: string) => void | Promise<void>,
) {
  if (json) return writeAgentsCliResult('list', value, true, stdout)
  if (value.length === 0) return stdout('No Agent definitions found.\n')
  return stdout(
    `${value
      .map(
        (entry) =>
          `${entry.name}\t${entry.scope}\t${entry.valid ? 'valid' : 'invalid'}\t${entry.description}`,
      )
      .join('\n')}\n`,
  )
}

export function compactAgentCatalog(
  items: readonly {
    readonly name: string
    readonly scope: string
    readonly description: string
    readonly sourcePath: string
    readonly loadError?: string
  }[],
) {
  return items.map((item) => ({
    name: item.name,
    description: item.description,
    scope: item.scope,
    sourcePath: item.sourcePath,
    valid: !item.loadError,
    ...(item.loadError ? { diagnostic: item.loadError } : {}),
  }))
}
