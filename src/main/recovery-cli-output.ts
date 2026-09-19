export const RECOVERY_CLI_OUTPUT_SCHEMA_VERSION = 1 as const

export function writeRecoveryCliError(
  error: unknown,
  json: boolean,
  stderr: (value: string) => void = process.stderr.write.bind(process.stderr),
) {
  const message = error instanceof Error ? error.message : String(error)
  const output = json
    ? JSON.stringify({ schemaVersion: RECOVERY_CLI_OUTPUT_SCHEMA_VERSION, error: { message } })
    : `error: ${message}`
  stderr(`${output}\n`)
}
