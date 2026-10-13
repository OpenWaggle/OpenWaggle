import type { ExternalMcpImportSource } from './import-types'

const NAME = '[A-Za-z_][A-Za-z0-9_]*'
const ENV_REFERENCE = `\\$\\{env:(${NAME})\\}`

/**
 * The variable syntaxes each tool really expands in `env` and `headers` values, with the Pi
 * variable each one becomes. Everything else is literal text there: Claude Desktop, Codex, and Zed
 * pass values as written.
 */
const SOURCE_VARIABLES: Readonly<Record<ExternalMcpImportSource, RegExp | undefined>> = {
  'claude-code': new RegExp(`\\$\\{(${NAME})(:-[^}]*)?\\}`, 'g'),
  cursor: new RegExp(ENV_REFERENCE, 'g'),
  vscode: new RegExp(`\\$\\{(?:env:(${NAME})|input:([^}]+))\\}`, 'g'),
  windsurf: new RegExp(ENV_REFERENCE, 'g'),
  opencode: new RegExp(`\\{env:(${NAME})\\}`, 'g'),
  'claude-desktop': undefined,
  codex: undefined,
  zed: undefined,
}

/** The variable syntax `source` expands in `env` and `headers` values, if any. */
export function sourceVariablePattern(source: ExternalMcpImportSource) {
  return SOURCE_VARIABLES[source]
}
