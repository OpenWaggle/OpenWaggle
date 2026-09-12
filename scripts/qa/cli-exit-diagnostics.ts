import { isMatching, P } from '@diegogbrisa/ts-match'
import { redactSensitiveText } from '../../src/main/utils/redact'

const CLI_DIAGNOSTIC_CHARACTER_LIMIT = 1_000
const CLI_DIAGNOSTIC_JSON_LIMIT = 16 * 1024
const POSSIBLE_PROFILE_CREDENTIAL = /[A-Za-z0-9_-]{43,}/gu

function rejectionDiagnostic(stdout: string) {
  if (!stdout) return ''
  if (stdout.length > CLI_DIAGNOSTIC_JSON_LIMIT) return ' stdout: omitted (size limit).'
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (!isMatching({ outcome: { effect: 'rejected', code: P.string } }, parsed)) {
      return ' stdout: omitted (unrecognized response).'
    }
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(parsed.outcome.code)) return ' outcome: rejected.'
    const code = parsed.outcome.code.replace(POSSIBLE_PROFILE_CREDENTIAL, '[REDACTED_CREDENTIAL]')
    return ` outcome: rejected (${code}).`
  } catch {
    return ' stdout: omitted (invalid JSON).'
  }
}

export function cliProcessError(error: unknown) {
  return cliExitError(
    isMatching({ code: P.integer }, error) ? error.code : null,
    isMatching({ signal: P.string }, error) ? error.signal : null,
    isMatching({ stderr: P.string }, error) ? error.stderr : '',
    isMatching({ stdout: P.string }, error) ? error.stdout : '',
  )
}

/** Arguments and raw stdout can contain credentials; only extract a bounded rejection code. */
export function cliExitError(code: number | null, signal: string | null, stderr: string, stdout = '') {
  const safeSignal = signal !== null && /^SIG[A-Z]{1,16}$/u.test(signal) ? signal : null
  const message = `OpenWaggle CLI exited with ${String(code ?? safeSignal)}.${rejectionDiagnostic(stdout)}`
  if (!stderr) return new Error(message)
  const escaped = JSON.stringify(
    redactSensitiveText(stderr).replace(POSSIBLE_PROFILE_CREDENTIAL, '[REDACTED_CREDENTIAL]'),
  )
  const excerpt = escaped.slice(0, CLI_DIAGNOSTIC_CHARACTER_LIMIT)
  return new Error(`${message} stderr: ${excerpt}${escaped.length > excerpt.length ? '…' : ''}`)
}
