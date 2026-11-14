/**
 * A content-free summary of why the Session Host did not start or stopped, reported as an
 * `application` error so it keeps its message (issue #446). Every other report keeps only an error
 * type and code, so a `LocalSessionClientTimeoutError` or a stopped PowerShell helper said nothing
 * about which helper or stage failed.
 *
 * The message holds only facts that cannot quote user content: error type names, Node.js error
 * codes, and the `stage`, `exitCode`, `signalCode` and `win32Code` the Windows helpers set from
 * their own fixed diagnostics. Anything that does not match those shapes is left out, and the
 * original error is not attached: the summary is the whole report.
 *
 * A type name is kept only when it is built in or one of the app's own startup errors below. Like
 * every other report (ADR 0045), an error class defined by code outside the app, such as a Pi
 * extension the Session Host loads, becomes `Error`, because its name can name a private project.
 */
import {
  ERROR_REPORT_BUILT_IN_ERROR_TYPES,
  NODE_ERROR_CODE_PATTERN,
  STARTUP_FAILURE_SUMMARY_NON_ERROR,
  type StartupFailureSummaryContext,
} from '@shared/error-reporting/error-report-rules'

/**
 * Where the summary comes from. Its message follows the shared grammar in
 * src/shared/error-reporting/error-report-startup-summary.ts, so the scrubbers keep it.
 */
export type StartupFailureContext = StartupFailureSummaryContext

const SUMMARY_NAMES: Readonly<Record<StartupFailureContext, string>> = {
  'gui-session-host-start': 'SessionHostStartupFailure',
  'gui-bootstrap': 'GuiBootstrapFailure',
  'session-host': 'SessionHostFatalError',
}

/** The Windows helpers' errors, the only ones whose stage and exit facts the summary reads. */
const WINDOWS_HELPER_ERROR_TYPES: ReadonlySet<string> = new Set([
  'WindowsUserOnlySecurityError',
  'WindowsUserOnlySecurityTimeoutError',
  'WindowsHeadlessLaunchError',
])

/** The app's own errors a Session Host or GUI startup can fail with, kept by name. */
const STARTUP_ERROR_TYPES: ReadonlySet<string> = new Set([
  ...WINDOWS_HELPER_ERROR_TYPES,
  'LocalSessionClientTimeoutError',
  'LocalSessionClientProtocolError',
  'LocalSessionHostConnectionClosedError',
  'LocalSessionHostUnavailableError',
  'LocalSessionHostUpgradePendingError',
  'GuiStartupRestartRequiredError',
  'GuiSessionHostRetiredForUpgradeError',
  'DesktopNativeQuarantinedError',
  'DesktopNativeRecoveryError',
  'DesktopNativeRecoveryUnavailableError',
  'DesktopServiceAttachmentError',
  'ProcessFileLockTimeoutError',
  'McpMigrationSourceError',
  'FilesystemWriteScopeError',
  'ProfileCredentialPreparationError',
  'SettingsStoreReadError',
])

/** A named fact of the summary, left out when its value is missing or malformed. */
type Fact = readonly [string, string | undefined]

const MAX_CAUSE_DEPTH = 4
const GENERIC_ERROR_TYPE = 'Error'
const STAGE = /^[a-z][a-z0-9-]{0,39}$/u
const SIGNAL = /^SIG[A-Z0-9]{1,10}$/u
const INTEGER = /^-?\d{1,10}$/u

function property(error: Error, key: string) {
  const value: unknown = Reflect.get(error, key)
  return value
}

function safeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && INTEGER.test(String(value))
    ? String(value)
    : undefined
}

function matching(value: unknown, pattern: RegExp) {
  return typeof value === 'string' && pattern.test(value) ? value : undefined
}

function typeName(error: Error) {
  const { name } = error
  return ERROR_REPORT_BUILT_IN_ERROR_TYPES.has(name) || STARTUP_ERROR_TYPES.has(name)
    ? name
    : GENERIC_ERROR_TYPE
}

function helperFacts(error: Error) {
  const facts: readonly Fact[] = WINDOWS_HELPER_ERROR_TYPES.has(error.name)
    ? [
        ['stage', matching(property(error, 'stage'), STAGE)],
        ['exit', safeInteger(property(error, 'exitCode'))],
        ['signal', matching(property(error, 'signalCode'), SIGNAL)],
        ['win32', safeInteger(property(error, 'win32Code'))],
      ]
    : []
  return facts
}

function errorFacts(error: Error) {
  const facts = [typeName(error)]
  const named: readonly Fact[] = [
    ['code', matching(property(error, 'code'), NODE_ERROR_CODE_PATTERN)],
    ...helperFacts(error),
  ]
  for (const [key, value] of named) {
    if (value !== undefined) facts.push(`${key}=${value}`)
  }
  return facts.join(' ')
}

/** The error and its causes, outermost first; `failure` is how a restart wrapper keeps its cause. */
function errorChain(error: unknown) {
  const chain: Error[] = []
  const seen = new Set<Error>()
  let current: unknown = error
  while (current instanceof Error && chain.length < MAX_CAUSE_DEPTH && !seen.has(current)) {
    chain.push(current)
    seen.add(current)
    current = current.cause ?? property(current, 'failure')
  }
  return chain
}

export class StartupFailureSummary extends Error {
  constructor(context: StartupFailureContext, error: unknown) {
    const chain = errorChain(error)
    const facts =
      chain.length > 0 ? chain.map(errorFacts).join(' <- ') : STARTUP_FAILURE_SUMMARY_NON_ERROR
    // No `cause`: an `application` report keeps the message of every linked error, and the
    // original's message can quote helper stderr or paths.
    super(`${context}: ${facts}`)
    this.name = SUMMARY_NAMES[context]
    // The original stack locates the failure, so reports of one failure group together. Only its
    // frame lines: a multi-line message (helper stderr) must not ride along in the stack.
    const [original] = chain
    const frames = original?.stack
      ?.split('\n')
      .filter((line) => /^\s+at /u.test(line))
      .join('\n')
    if (frames) this.stack = `${this.name}: ${this.message}\n${frames}`
  }
}
