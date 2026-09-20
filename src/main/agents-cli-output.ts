const JSON_INDENT_SPACES = 2
export const AGENTS_CLI_OUTPUT_SCHEMA_VERSION = 1 as const

export interface CompactAgentCatalogItem {
  readonly name: string
  readonly scope: string
  readonly description: string
  readonly valid: boolean
  readonly sourcePath: string
  readonly diagnostic?: string
}

export function writeAgentsCliResult(
  value: unknown,
  json: boolean,
  stdout: (value: string) => void | Promise<void>,
) {
  if (json) {
    return stdout(
      `${JSON.stringify(
        { schemaVersion: AGENTS_CLI_OUTPUT_SCHEMA_VERSION, result: value },
        null,
        JSON_INDENT_SPACES,
      )}\n`,
    )
  }
  return stdout(`${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`)
}

export function writeAgentsCliError(
  error: unknown,
  json: boolean,
  stderr: (value: string) => void,
) {
  const message = error instanceof Error ? error.message : String(error)
  const output = json
    ? JSON.stringify({
        schemaVersion: AGENTS_CLI_OUTPUT_SCHEMA_VERSION,
        error: { message },
      })
    : `error: ${message}`
  stderr(`${output}\n`)
}

export function writeAgentsCliCatalog(
  value: readonly CompactAgentCatalogItem[],
  json: boolean,
  stdout: (value: string) => void | Promise<void>,
) {
  if (json) return writeAgentsCliResult(value, true, stdout)
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
