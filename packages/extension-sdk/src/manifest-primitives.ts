import * as Schema from 'effect/Schema'
import { OPENWAGGLE_EXTENSION, OPENWAGGLE_EXTENSION_BROKER } from './constants.js'

export const extensionNonEmptyStringSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter((value) => value.trim().length > 0 || 'Must not be empty.'),
)

function isExtensionId(value: string) {
  if (value.length > OPENWAGGLE_EXTENSION.LIMITS.ID_MAX_LENGTH) {
    return `Must be at most ${OPENWAGGLE_EXTENSION.LIMITS.ID_MAX_LENGTH} characters.`
  }
  return (
    OPENWAGGLE_EXTENSION.PATTERNS.ID.test(value) ||
    'Use lowercase letters, numbers, dots, underscores, and dashes; start with a letter or number.'
  )
}

function isContributionId(value: string) {
  if (value.length > OPENWAGGLE_EXTENSION.LIMITS.CONTRIBUTION_ID_MAX_LENGTH) {
    return `Must be at most ${OPENWAGGLE_EXTENSION.LIMITS.CONTRIBUTION_ID_MAX_LENGTH} characters.`
  }
  return (
    OPENWAGGLE_EXTENSION.PATTERNS.CONTRIBUTION_ID.test(value) ||
    'Use lowercase letters, numbers, dots, underscores, dashes, and forward slashes; start with a letter or number.'
  )
}

function isSemverVersion(value: string) {
  return (
    OPENWAGGLE_EXTENSION.PATTERNS.SEMVER_VERSION.test(value) ||
    'Must be a semantic version such as 1.2.3.'
  )
}

function isPortableRelativePath(value: string) {
  const trimmed = value.trim()
  if (trimmed.length === 0) return 'Must not be empty.'
  if (value !== trimmed) return 'Must not have leading or trailing whitespace.'
  if (trimmed.length > OPENWAGGLE_EXTENSION.LIMITS.RELATIVE_PATH_MAX_LENGTH) {
    return `Must be at most ${OPENWAGGLE_EXTENSION.LIMITS.RELATIVE_PATH_MAX_LENGTH} characters.`
  }
  if (trimmed.includes(OPENWAGGLE_EXTENSION.PATH.NUL_CHARACTER)) {
    return 'Must not contain NUL bytes.'
  }
  if (
    trimmed.startsWith(OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR) ||
    trimmed.startsWith(OPENWAGGLE_EXTENSION.PATH.WINDOWS_SEPARATOR) ||
    OPENWAGGLE_EXTENSION.PATTERNS.WINDOWS_ABSOLUTE_PATH.test(trimmed)
  ) {
    return 'Must be relative to the extension package root.'
  }

  const segments = trimmed
    .replaceAll(
      OPENWAGGLE_EXTENSION.PATH.WINDOWS_SEPARATOR,
      OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR,
    )
    .split(OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR)
  return (
    !segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === OPENWAGGLE_EXTENSION.PATH.CURRENT_DIRECTORY_SEGMENT ||
        segment === OPENWAGGLE_EXTENSION.PATH.RELATIVE_PARENT_SEGMENT,
    ) || 'Must not contain empty, "." or ".." path segments.'
  )
}

export function isBuildCommand(value: string) {
  if (value.length > OPENWAGGLE_EXTENSION.LIMITS.BUILD_COMMAND_MAX_LENGTH) {
    return `Must be at most ${OPENWAGGLE_EXTENSION.LIMITS.BUILD_COMMAND_MAX_LENGTH} characters.`
  }
  if (value.includes(OPENWAGGLE_EXTENSION.PATH.NUL_CHARACTER)) {
    return 'Must not contain NUL bytes.'
  }
  return (!value.includes('\n') && !value.includes('\r')) || 'Must be a single command line.'
}

export function isRuntimeRequirementBinary(value: string) {
  const trimmed = value.trim()
  if (value !== trimmed) return 'Must not have leading or trailing whitespace.'
  if (value.length > OPENWAGGLE_EXTENSION.LIMITS.RUNTIME_REQUIREMENT_BINARY_MAX_LENGTH) {
    return `Must be at most ${OPENWAGGLE_EXTENSION.LIMITS.RUNTIME_REQUIREMENT_BINARY_MAX_LENGTH} characters.`
  }
  if (value.includes(OPENWAGGLE_EXTENSION.PATH.NUL_CHARACTER)) {
    return 'Must not contain NUL bytes.'
  }
  if (value.includes('\n') || value.includes('\r')) return 'Must be a single executable name.'
  return (
    (!value.includes(OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR) &&
      !value.includes(OPENWAGGLE_EXTENSION.PATH.WINDOWS_SEPARATOR)) ||
    'Must be an executable name, not a path.'
  )
}

export function isNetworkOrigin(value: string) {
  const trimmed = value.trim()
  if (value !== trimmed) return 'Must not have leading or trailing whitespace.'
  if (value.length > OPENWAGGLE_EXTENSION.LIMITS.NETWORK_ORIGIN_MAX_LENGTH) {
    return `Must be at most ${OPENWAGGLE_EXTENSION.LIMITS.NETWORK_ORIGIN_MAX_LENGTH} characters.`
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Must be a valid URL origin.'
  }
  if (url.protocol !== 'https:') return 'Must use https.'
  return (
    url.origin === value ||
    'Must be an exact origin without a path, query, fragment, or trailing slash.'
  )
}

export function validateBrokerCapabilityDeclaration(declaration: {
  readonly id: string
  readonly methods?: readonly string[]
}) {
  const supportedMethods =
    OPENWAGGLE_EXTENSION_BROKER.CAPABILITY_METHODS.find(
      (descriptor) => descriptor.capability === declaration.id,
    )?.methods ?? null
  if (supportedMethods === null) return true
  if (declaration.methods === undefined || declaration.methods.length === 0) {
    return `Built-in broker capability "${declaration.id}" must declare at least one supported method.`
  }

  const unsupportedMethod = declaration.methods.find(
    (declaredMethod) => !supportedMethods.some((method) => method === declaredMethod),
  )
  return (
    unsupportedMethod === undefined ||
    `Built-in broker capability "${declaration.id}" does not support method "${unsupportedMethod}".`
  )
}

function isNotRuntimeModuleContextEntryPath(value: string) {
  const [firstSegment] = value
    .replaceAll(
      OPENWAGGLE_EXTENSION.PATH.WINDOWS_SEPARATOR,
      OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR,
    )
    .split(OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR)
  return (
    firstSegment !== OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL.MODULE_CONTEXT_SEGMENT ||
    `Must not start with the reserved "${OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL.MODULE_CONTEXT_SEGMENT}" runtime module path segment.`
  )
}

export const extensionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(isExtensionId),
)
export const extensionContributionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(isContributionId),
)
export const extensionSemverVersionSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(isSemverVersion),
)
export const extensionRelativePathSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(isPortableRelativePath),
)
export const extensionContributionEntryPathSchema = extensionRelativePathSchema.pipe(
  Schema.filter(isNotRuntimeModuleContextEntryPath),
)
export const extensionCapabilityScopeSchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES,
)
export const extensionContributionRuntimeSchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIMES,
)
export const extensionExecutionPlacementSchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENTS,
)
export const extensionContributionFamilySchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILIES,
)
export const extensionCommandContributionFamilySchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.COMMAND_CONTRIBUTION_FAMILIES,
)
export const extensionSlotContributionFamilySchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.SLOT_CONTRIBUTION_FAMILIES,
)
