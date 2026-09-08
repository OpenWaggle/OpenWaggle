import { redactSensitiveText } from '../../src/main/utils/redact'

const CLI_DIAGNOSTIC_CHARACTER_LIMIT = 1_000
const POSSIBLE_PROFILE_CREDENTIAL = /[A-Za-z0-9_-]{43,}/gu

/** Report only bounded, escaped stderr. CLI stdout and arguments can contain credentials. */
export function cliExitError(code: number | null, signal: NodeJS.Signals | null, stderr: string) {
  const message = `OpenWaggle CLI exited with ${String(code ?? signal)}.`
  if (!stderr) return new Error(message)
  const escaped = JSON.stringify(
    redactSensitiveText(stderr).replace(POSSIBLE_PROFILE_CREDENTIAL, '[REDACTED_CREDENTIAL]'),
  )
  const excerpt = escaped.slice(0, CLI_DIAGNOSTIC_CHARACTER_LIMIT)
  return new Error(`${message} stderr: ${excerpt}${escaped.length > excerpt.length ? '…' : ''}`)
}
