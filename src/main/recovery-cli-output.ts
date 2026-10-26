import { sessionsCliResponseText, writeSessionsCliError } from './sessions-cli-output'

const JSON_INDENT_SPACES = 2

/** Recovery reports like every other CLI: the Hive CLI envelopes and error kinds (#351). */
export function writeRecoveryCliError(
  error: unknown,
  json: boolean,
  stderr: (value: string) => unknown = (value) => process.stderr.write(value),
) {
  return writeSessionsCliError(error, json, stderr)
}

export function recoveryCliResultText(command: string, value: unknown, json: boolean) {
  return json
    ? sessionsCliResponseText(`recovery ${command}`, value, true)
    : `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`
}
