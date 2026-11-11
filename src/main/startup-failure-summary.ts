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
 */

export type StartupFailureContext =
  /** The GUI's window is open and shows the startup error screen. */
  | 'gui-session-host-start'
  /** The GUI failed before its window could show anything and exits. */
  | 'gui-bootstrap'
  /** The detached Session Host stopped on an unrecoverable error. */
  | 'session-host'

const SUMMARY_NAMES: Readonly<Record<StartupFailureContext, string>> = {
  'gui-session-host-start': 'SessionHostStartupFailure',
  'gui-bootstrap': 'GuiBootstrapFailure',
  'session-host': 'SessionHostFatalError',
}

const MAX_CAUSE_DEPTH = 4
const ERROR_TYPE_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/u
const NODE_ERROR_CODE = /^E[A-Z0-9_]{1,40}$/u
const STAGE = /^[a-z][a-z0-9-]{0,39}$/u
const SIGNAL = /^SIG[A-Z0-9]{1,10}$/u
const MAX_SAFE_INTEGER_DIGITS = 11

function property(error: Error, key: string): unknown {
  return Reflect.get(error, key)
}

function safeInteger(value: unknown) {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    String(value).length <= MAX_SAFE_INTEGER_DIGITS
    ? String(value)
    : undefined
}

function matching(value: unknown, pattern: RegExp) {
  return typeof value === 'string' && pattern.test(value) ? value : undefined
}

function errorFacts(error: Error) {
  const facts = [matching(error.name, ERROR_TYPE_NAME) ?? 'Error']
  const named: ReadonlyArray<readonly [string, string | undefined]> = [
    ['code', matching(property(error, 'code'), NODE_ERROR_CODE)],
    ['stage', matching(property(error, 'stage'), STAGE)],
    ['exit', safeInteger(property(error, 'exitCode'))],
    ['signal', matching(property(error, 'signalCode'), SIGNAL)],
    ['win32', safeInteger(property(error, 'win32Code'))],
  ]
  for (const [key, value] of named) {
    if (value !== undefined) facts.push(`${key}=${value}`)
  }
  return facts.join(' ')
}

/** The error and its causes, outermost first; `failure` is how a restart wrapper keeps its cause. */
function errorChain(error: unknown) {
  const chain: Error[] = []
  let current: unknown = error
  while (current instanceof Error && chain.length < MAX_CAUSE_DEPTH && !chain.includes(current)) {
    chain.push(current)
    current = current.cause ?? property(current, 'failure')
  }
  return chain
}

export class StartupFailureSummary extends Error {
  constructor(context: StartupFailureContext, error: unknown) {
    const chain = errorChain(error)
    const facts = chain.length > 0 ? chain.map(errorFacts).join(' <- ') : 'non-error value'
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
