/**
 * The rules for where a report's code lives (ADR 0045), part of the shared error-report rules
 * (./error-report-rules.ts re-exports them). Code outside the app, such as a Pi extension or a
 * worktree's code running in the Session Host, is named by its author, so its folders, file names,
 * function names and error classes can name a private project, the same in every report from one
 * install. Such code keeps only `<external>`, and an exception it threw keeps a built-in error
 * type. Like the other rules this module imports nothing, so the statistics endpoint bundles it.
 */

/** App code (`app:///`, the renderer's `RENDERER_PROTOCOL_ORIGIN`, see src/main) and Node.js. */
const OWN_CODE_PREFIXES = ['app:///', 'node:', 'openwaggle://app/'] as const
/**
 * Native code and V8's pseudo-locations: `<anonymous>`, `<data:…>`, `Promise.all`'s `index 0`.
 * `<external>` marks code these rules already reduced, which stays external.
 */
const PSEUDO_CODE_LOCATION = /^(?:native|\[native code\]|<(?!external>)[^>]*>|index \d+)$/u
const EXTERNAL_CODE = '<external>'
/** The one file name external code keeps, an entry module's, which names nothing. */
const ENTRY_MODULE_NAME = /^index\.[cm]?[jt]sx?$/u
/** The type an exception from external code is reported by, unless its own is built in. */
const GENERIC_ERROR_TYPE = 'Error'

/** Stack frame fields naming where the frame's code lives. */
export const ERROR_REPORT_FRAME_LOCATION_KEYS = ['filename', 'abs_path'] as const
/** Stack frame fields naming the frame's function. */
export const ERROR_REPORT_FRAME_NAME_KEYS = ['function', 'raw_function'] as const
/** Debug image fields naming a code file. */
export const ERROR_REPORT_DEBUG_IMAGE_LOCATION_KEYS = ['code_file', 'debug_file'] as const

/**
 * Error types JavaScript, the web platform and Node.js define, which name no one's code: the
 * ECMAScript errors, DOMException and the names it carries, WebAssembly's, Node.js's, and the
 * type Sentry gives a rejection with a value that is not an error.
 */
export const ERROR_REPORT_BUILT_IN_ERROR_TYPES: ReadonlySet<string> = new Set(
  [
    'Error TypeError RangeError SyntaxError ReferenceError EvalError URIError AggregateError',
    'SuppressedError InternalError',
    'DOMException DOMError AbortError TimeoutError NotFoundError NotAllowedError',
    'NotSupportedError NotReadableError NetworkError SecurityError QuotaExceededError',
    'DataCloneError InvalidStateError InvalidAccessError InvalidCharacterError OperationError',
    'EncodingError UnknownError ConstraintError DataError HierarchyRequestError',
    'IndexSizeError NamespaceError InvalidModificationError NoModificationAllowedError',
    'TransactionInactiveError ReadOnlyError VersionError TypeMismatchError URLMismatchError',
    'CompileError LinkError RuntimeError',
    'SystemError AssertionError',
    'UnhandledRejection',
  ]
    .join(' ')
    .split(' '),
)

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

/** Whether `location` is code the app ships, Node.js code or native code. */
export function isOwnErrorReportCodeLocation(location: string): boolean {
  return (
    location === '' ||
    PSEUDO_CODE_LOCATION.test(location) ||
    OWN_CODE_PREFIXES.some((prefix) => location.startsWith(prefix))
  )
}

/**
 * `location` itself for code the app ships, Node.js code and native code. Any other location
 * becomes `<external>`, or `<external>/index.js` and the like for an entry module.
 */
export function scrubErrorReportCodeLocation(location: string): string {
  if (isOwnErrorReportCodeLocation(location)) return location
  const path = location.replace(/[?#].*$/u, '').replace(/[\\/]+$/u, '')
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  return ENTRY_MODULE_NAME.test(name) ? `${EXTERNAL_CODE}/${name}` : EXTERNAL_CODE
}

/** Whether a stack frame's code lives outside the app, Node.js and native code. */
export function isExternalErrorReportFrame(frame: unknown): boolean {
  return ERROR_REPORT_FRAME_LOCATION_KEYS.some((key) => {
    const location: unknown = isObject(frame) ? Reflect.get(frame, key) : undefined
    return typeof location === 'string' && !isOwnErrorReportCodeLocation(location)
  })
}

function scrubLocations(holder: object, keys: readonly string[]) {
  for (const key of keys) {
    const location: unknown = Reflect.get(holder, key)
    if (typeof location !== 'string') continue
    Reflect.set(holder, key, scrubErrorReportCodeLocation(location))
  }
}

/** Rewrites an external stack frame in place: `<external>` locations and names, no module. */
export function scrubErrorReportFrameLocation(frame: object): void {
  if (!isExternalErrorReportFrame(frame)) return
  scrubLocations(frame, ERROR_REPORT_FRAME_LOCATION_KEYS)
  for (const key of ERROR_REPORT_FRAME_NAME_KEYS) {
    if (typeof Reflect.get(frame, key) === 'string') Reflect.set(frame, key, EXTERNAL_CODE)
  }
  Reflect.deleteProperty(frame, 'module')
}

/** Rewrites, in place, the code file of every external image in an event's `debug_meta`. */
export function scrubErrorReportDebugMeta(debugMeta: unknown): void {
  const images: unknown = isObject(debugMeta) ? Reflect.get(debugMeta, 'images') : undefined
  if (!Array.isArray(images)) return
  for (const image of images) {
    if (isObject(image)) scrubLocations(image, ERROR_REPORT_DEBUG_IMAGE_LOCATION_KEYS)
  }
}

/** Whether the frame that threw, the last of the stack trace, is the app's or Node.js's code. */
function thrownByOwnCode(exception: object) {
  const stacktrace: unknown = Reflect.get(exception, 'stacktrace')
  const frames: unknown = isObject(stacktrace) ? Reflect.get(stacktrace, 'frames') : undefined
  const thrower: unknown = Array.isArray(frames) ? frames.at(-1) : undefined
  const location: unknown = isObject(thrower) ? Reflect.get(thrower, 'filename') : undefined
  return (
    typeof location === 'string' && OWN_CODE_PREFIXES.some((prefix) => location.startsWith(prefix))
  )
}

/**
 * Keeps an exception's type, in place, when it is a built-in error type or the app's or Node.js's
 * code threw the exception; any other type, such as an extension's own error class, becomes
 * `Error`. An exception without a stack trace counts as thrown by external code.
 */
export function scrubErrorReportExceptionType(exception: object): void {
  const type: unknown = Reflect.get(exception, 'type')
  if (typeof type !== 'string' || ERROR_REPORT_BUILT_IN_ERROR_TYPES.has(type)) return
  if (!thrownByOwnCode(exception)) Reflect.set(exception, 'type', GENERIC_ERROR_TYPE)
}
