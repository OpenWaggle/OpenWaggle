/**
 * The JSON Schema keywords for the manifest's string rules. Effect emits no JSON Schema for a
 * `Schema.filter`, so each filter names the pattern and length that state its rule for the
 * published manifest JSON Schema. The filters stay the rule OpenWaggle runs; a test checks the
 * two agree on the same samples.
 */
import { OPENWAGGLE_EXTENSION } from '../constants.js'

const { LIMITS, PATTERNS, RUNTIME_MODULE_PROTOCOL } = OPENWAGGLE_EXTENSION

/** No leading or trailing whitespace. `[\s\S]` because `.` stops at a line break. */
const TRIMMED = String.raw`(?!\s)(?![\s\S]*\s$)`
const PATH_SEGMENT = String.raw`[^\\/\u0000]+`

export const MANIFEST_JSON_SCHEMA = {
  NON_EMPTY: { pattern: String.raw`\S` },
  ID: { pattern: PATTERNS.ID.source, maxLength: LIMITS.ID_MAX_LENGTH },
  CONTRIBUTION_ID: {
    pattern: PATTERNS.CONTRIBUTION_ID.source,
    maxLength: LIMITS.CONTRIBUTION_ID_MAX_LENGTH,
  },
  SEMVER_VERSION: { pattern: PATTERNS.SEMVER_VERSION.source },
  /** Relative, with no empty, "." or ".." segment, no NUL byte and no drive letter. */
  RELATIVE_PATH: {
    pattern: String.raw`^${TRIMMED}(?![A-Za-z]:[\\/])(?!(?:[\s\S]*[\\/])?\.{1,2}(?:[\\/]|$))${PATH_SEGMENT}(?:[\\/]${PATH_SEGMENT})*$`,
    maxLength: LIMITS.RELATIVE_PATH_MAX_LENGTH,
  },
  ENTRY_PATH: {
    pattern: String.raw`^(?!${RUNTIME_MODULE_PROTOCOL.MODULE_CONTEXT_SEGMENT}(?:[\\/]|$))`,
  },
  SVG_PATH: { pattern: String.raw`\.[Ss][Vv][Gg]$` },
  BUILD_COMMAND: {
    pattern: String.raw`^[^\r\n\u0000]*$`,
    maxLength: LIMITS.BUILD_COMMAND_MAX_LENGTH,
  },
  RUNTIME_REQUIREMENT_BINARY: {
    pattern: String.raw`^${TRIMMED}[^\\/\r\n\u0000]+$`,
    maxLength: LIMITS.RUNTIME_REQUIREMENT_BINARY_MAX_LENGTH,
  },
  /** An exact HTTPS origin: lowercase host, an optional port other than 443, nothing after. */
  NETWORK_ORIGIN: {
    pattern: String.raw`^https://(?:[a-z0-9_-]+(?:\.[a-z0-9_-]+)*|\[[0-9a-f:.]+\])(?::(?!443$)[0-9]{1,5})?$`,
    maxLength: LIMITS.NETWORK_ORIGIN_MAX_LENGTH,
  },
} as const
