/**
 * The rules every OpenWaggle error report is scrubbed by (ADR 0045): in the app before a report
 * leaves, and again at the statistics endpoint before Sentry receives it. Keeping them in one
 * module keeps the two scrubbers identical. It imports only the error-report constants and no
 * path alias, so the endpoint can bundle it.
 *
 * Text rules apply to every string and key of a report, path rules first:
 *
 * - home directories become `~`: `/Users/<name>`, `/home/<name>` and `/var/home/<name>` where a
 *   path starts, `/root`, macOS's `/System/Volumes/Data/Users/<name>`, `C:\Users\<profile>`
 *   with either separator, a drive-less `\Users\<profile>`, and WSL's
 *   `\\wsl.localhost\<distro>\home\<name>`, `\\wsl$\<distro>\home\<name>` and
 *   `/mnt/<drive>/Users/<profile>`. A Windows profile name ends only at a separator, a
 *   character Windows forbids in names, or a line end, so names with spaces or apostrophes go
 *   whole. The shared folders (`/Users/Shared`, `C:\Users\Public`, `Default`, `Default User`,
 *   `All Users`) stay;
 * - macOS per-user temporary folders `(/private)/var/folders/<a>/<b>` become `<tmp>`;
 * - OpenWaggle scratch and evidence folders, `ow-scratch[-<uid>]/<profile>[/evidence][/<id>]`,
 *   become `<scratch>`;
 * - then UUIDs, such as Session and Run ids, become `<id>`, and other hex runs of 16 or more
 *   characters `<hex>`.
 *
 * Stack frames and debug images whose code lives outside the app keep only `<external>`, and an
 * exception that code threw keeps a built-in error type: ./error-report-code-rules.ts, re-exported
 * here so the endpoint has one module to import.
 *
 * A report keeps message text only when the app reported it itself as a handled `application`
 * error ({@link keepsErrorReportMessageText}); every other report keeps only error types and codes.
 */
import { ERROR_REPORT_ORIGIN_TAG } from './error-report-constants'

export {
  ERROR_REPORT_BUILT_IN_ERROR_TYPES,
  ERROR_REPORT_DEBUG_IMAGE_LOCATION_KEYS,
  ERROR_REPORT_FRAME_LOCATION_KEYS,
  ERROR_REPORT_FRAME_NAME_KEYS,
  isExternalErrorReportFrame,
  isOwnErrorReportCodeLocation,
  scrubErrorReportCodeLocation,
  scrubErrorReportDebugMeta,
  scrubErrorReportExceptionType,
  scrubErrorReportFrameLocation,
} from './error-report-code-rules'

const HOME = '~'
const TEMPORARY = '<tmp>'
const SCRATCH = '<scratch>'
const IDENTIFIER = '<id>'
const HEX_RUN = '<hex>'

const SEPARATOR = String.raw`(?:\\+|\/+)`
/** A Windows profile name: anything up to a separator, a forbidden character or a line end. */
const WINDOWS_NAME = String.raw`[^\\/"<>|:*?\r\n]+`
const WINDOWS_NAME_END = String.raw`(?=[\\/"<>|:*?\r\n]|$)`
/** A POSIX folder name, which never holds a separator, whitespace or quote. */
const POSIX_NAME = String.raw`[^/\\\s"'\x60<>|:*?]+`
/** A POSIX user name, which also never holds brackets or list punctuation. */
const POSIX_USER = String.raw`[^/\\\s"'\x60<>|:*?,;()[\]{}]+`
const POSIX_NAME_END = String.raw`(?=[/\\\s"'\x60<>|:*?),;\]}]|$)`
/** Where a path starts: after `file://`, or after anything that cannot precede a path. */
const PATH_START = String.raw`(?:(?<=file:\/\/)|(?<![\w.~%@\]\-/\\]))`
const NOT_SHARED_WINDOWS_PROFILE = `(?!(?:Public|Default|Default User|All Users)${WINDOWS_NAME_END})`
const NOT_SHARED_MACOS_FOLDER = `(?!Shared${POSIX_NAME_END})`
/** A known directory matches only as a whole name, never as the start of a longer one. */
const KNOWN_DIRECTORY_END = String.raw`(?![^\\/\s"'\x60<>|:*?,;()[\]{}])`
const HEX_SEGMENT = '[0-9a-f]{4,64}'
/** A directory shorter than this (`/`, `C:`) is not a meaningful prefix to replace. */
const MIN_KNOWN_DIRECTORY_LENGTH = 3

type TextRule = readonly [pattern: RegExp, replacement: string]

const PATH_RULES: readonly TextRule[] = [
  [
    new RegExp(
      String.raw`(?:\\\\|\/\/)wsl(?:\.localhost|\$)${SEPARATOR}[^\\/\r\n]+${SEPARATOR}(?:home${SEPARATOR}${WINDOWS_NAME}|root${WINDOWS_NAME_END})`,
      'giu',
    ),
    HOME,
  ],
  [
    new RegExp(
      String.raw`\/mnt\/[a-z]\/Users\/${NOT_SHARED_WINDOWS_PROFILE}${WINDOWS_NAME}`,
      'giu',
    ),
    HOME,
  ],
  [
    new RegExp(
      String.raw`\b[a-z]:${SEPARATOR}Users${SEPARATOR}${NOT_SHARED_WINDOWS_PROFILE}${WINDOWS_NAME}`,
      'giu',
    ),
    HOME,
  ],
  [new RegExp(String.raw`\\+Users\\+${NOT_SHARED_WINDOWS_PROFILE}${WINDOWS_NAME}`, 'giu'), HOME],
  [
    new RegExp(
      String.raw`\/System\/Volumes\/Data\/Users\/${NOT_SHARED_MACOS_FOLDER}${POSIX_USER}`,
      'giu',
    ),
    HOME,
  ],
  [
    new RegExp(
      String.raw`${PATH_START}\\?\/(?:var\\?\/)?(?:Users|home)\\?\/${NOT_SHARED_MACOS_FOLDER}${POSIX_USER}`,
      'giu',
    ),
    HOME,
  ],
  [new RegExp(String.raw`${PATH_START}\\?\/root${POSIX_NAME_END}`, 'gu'), HOME],
  [
    new RegExp(String.raw`(?:\/private)?\/var\/folders\/${POSIX_NAME}\/${POSIX_NAME}`, 'gu'),
    TEMPORARY,
  ],
  [
    new RegExp(
      `ow-scratch(?:-${POSIX_NAME})?(?:${SEPARATOR}${HEX_SEGMENT}(?:${SEPARATOR}evidence)?(?:${SEPARATOR}${HEX_SEGMENT})?)?`,
      'giu',
    ),
    SCRATCH,
  ],
]

const IDENTIFIER_RULES: readonly TextRule[] = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, IDENTIFIER],
  [/\b[0-9a-f]{16,}\b/giu, HEX_RUN],
]

function applyRules(text: string, rules: readonly TextRule[]) {
  return rules.reduce(
    (scrubbed, [pattern, replacement]) => scrubbed.replace(pattern, replacement),
    text,
  )
}

/** Replaces home directories and temporary and scratch folders in `text`. */
export function scrubErrorReportPaths(text: string): string {
  return applyRules(text, PATH_RULES)
}

/** Every text rule: paths first, then UUIDs and long hex runs. */
export function scrubErrorReportText(text: string): string {
  return applyRules(scrubErrorReportPaths(text), IDENTIFIER_RULES)
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\/]/gu, String.raw`\$&`)
}

function knownDirectoryRule(directory: string | undefined, replacement: string): TextRule[] {
  const trimmed = directory?.trim().replace(/[\\/]+$/u, '') ?? ''
  if (trimmed.length < MIN_KNOWN_DIRECTORY_LENGTH) return []
  const windows = /^[a-z]:[\\/]/iu.test(trimmed) || trimmed.includes('\\')
  const pattern = trimmed
    .split(/[\\/]+/u)
    .map(escapeRegExp)
    .join(windows ? SEPARATOR : String.raw`\/+`)
  // Case-insensitive: Windows and default macOS volumes treat `/users/Bob` as the same folder.
  return [[new RegExp(`${pattern}${KNOWN_DIRECTORY_END}`, 'giu'), replacement]]
}

export interface ErrorReportKnownDirectories {
  /** The current user's home directory, which becomes `~`. */
  readonly homeDirectory?: string | undefined
  /** The process's temporary directory, such as Windows `%TEMP%`, which becomes `<tmp>`. */
  readonly temporaryDirectory?: string | undefined
}

function knownDirectoryRules(known: ErrorReportKnownDirectories) {
  // The longest first, so a temporary directory inside the home directory keeps its own name.
  return [
    ...knownDirectoryRule(known.homeDirectory, HOME),
    ...knownDirectoryRule(known.temporaryDirectory, TEMPORARY),
  ].sort(([left], [right]) => right.source.length - left.source.length)
}

/**
 * Every text rule, after replacing the directories this machine is known to use. The app knows
 * them; the endpoint does not, and applies {@link scrubErrorReportText} alone.
 */
export function createErrorReportTextScrubber(
  known: ErrorReportKnownDirectories = {},
): (text: string) => string {
  const knownRules = knownDirectoryRules(known)
  return (text) => scrubErrorReportText(applyRules(text, knownRules))
}

/** The path rules alone, after the known directories, for fields that keep their identifiers. */
export function createErrorReportPathScrubber(
  known: ErrorReportKnownDirectories = {},
): (text: string) => string {
  const knownRules = knownDirectoryRules(known)
  return (text) => scrubErrorReportPaths(applyRules(text, knownRules))
}

/** Event fields Sentry needs verbatim: the event id and the release that groups reports. */
export const ERROR_REPORT_VERBATIM_EVENT_KEYS: ReadonlySet<string> = new Set([
  'event_id',
  'release',
  'dist',
])

/** Event fields that lose only paths, so their debug ids still match source maps. */
export const ERROR_REPORT_PATHS_ONLY_EVENT_KEYS: ReadonlySet<string> = new Set(['debug_meta'])

/**
 * Event fields dropped whole. `request` holds the window URL in the app, whose route can name a
 * Session.
 */
export const ERROR_REPORT_DROPPED_EVENT_KEYS: ReadonlySet<string> = new Set([
  'user',
  'server_name',
  'breadcrumbs',
  'request',
  'modules',
])

/** Local variables and the source lines around a frame, which can quote user code. */
export const ERROR_REPORT_DROPPED_FRAME_KEYS: ReadonlySet<string> = new Set([
  'vars',
  'context_line',
  'pre_context',
  'post_context',
])

/**
 * The only contexts and context fields a report keeps: OS name and version, CPU architecture, app
 * version and runtime versions. Locale, time zone, memory figures, boot and start times, the
 * device name, the trace and every other context are dropped.
 */
export const ERROR_REPORT_CONTEXT_ALLOWLIST: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['os', new Set(['name', 'version'])],
  ['device', new Set(['arch'])],
  ['app', new Set(['app_version'])],
  ['runtime', new Set(['name', 'version'])],
  ['browser', new Set(['name', 'version'])],
  ['chrome', new Set(['type', 'name', 'version'])],
  ['node', new Set(['type', 'name', 'version'])],
])

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function exceptionValues(event: unknown): readonly unknown[] {
  const exception: unknown = isObject(event) ? Reflect.get(event, 'exception') : undefined
  const values: unknown = isObject(exception) ? Reflect.get(exception, 'values') : undefined
  return Array.isArray(values) ? values : []
}

function handledFlag(exception: unknown): unknown {
  const mechanism: unknown = isObject(exception) ? Reflect.get(exception, 'mechanism') : undefined
  return isObject(mechanism) ? Reflect.get(mechanism, 'handled') : undefined
}

/** Whether nothing handled the error, such as an uncaught exception or unhandled rejection. */
export function hasUnhandledErrorReportException(event: unknown): boolean {
  return exceptionValues(event).some((exception) => handledFlag(exception) === false)
}

/**
 * Whether a report may keep its message text: only an error the app reported itself, tagged
 * `application`, whose thrown error is marked handled. Sentry lists linked causes first, so the
 * thrown error is the last exception. Crashes and tool or provider errors can quote user
 * content, so they keep only their error type and a code.
 */
export function keepsErrorReportMessageText(event: unknown): boolean {
  const tags: unknown = isObject(event) ? Reflect.get(event, 'tags') : undefined
  if (!isObject(tags) || Reflect.get(tags, ERROR_REPORT_ORIGIN_TAG) !== 'application') return false
  if (hasUnhandledErrorReportException(event)) return false
  return handledFlag(exceptionValues(event).at(-1)) === true
}

/** A Node.js error code such as `ENOENT` or `ERR_STREAM_PREMATURE_CLOSE`. */
export const NODE_ERROR_CODE_PATTERN = /^(?:E[A-Z0-9]{2,31}|ERR_[A-Z0-9_]{2,60})$/u
/** An HTTP status reported as a code, such as `http-429`. */
export const HTTP_ERROR_CODE_PATTERN = /^http-\d{3}$/u
const LEADING_NODE_ERROR_CODE_PATTERN = /^(?<code>E[A-Z0-9]{2,31}|ERR_[A-Z0-9_]{2,60})(?!\w)/u

/** The Node.js error code a message starts with, as in `ENOENT: no such file or directory`. */
export function leadingNodeErrorCode(text: string): string | undefined {
  return LEADING_NODE_ERROR_CODE_PATTERN.exec(text)?.groups?.code
}
