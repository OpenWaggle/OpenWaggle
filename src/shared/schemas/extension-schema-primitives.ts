import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'

export function isNonEmptyTrimmed(value: string) {
  return value.trim().length > 0 || 'Must not be empty.'
}

export function isExtensionId(value: string) {
  if (value.length > OPENWAGGLE_EXTENSION.LIMITS.ID_MAX_LENGTH) {
    return `Must be at most ${OPENWAGGLE_EXTENSION.LIMITS.ID_MAX_LENGTH} characters.`
  }
  return (
    OPENWAGGLE_EXTENSION.PATTERNS.ID.test(value) ||
    'Use lowercase letters, numbers, dots, underscores, and dashes; start with a letter or number.'
  )
}

export function isPortableRelativePath(value: string) {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return 'Must not be empty.'
  }
  if (value !== trimmed) {
    return 'Must not have leading or trailing whitespace.'
  }
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
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === OPENWAGGLE_EXTENSION.PATH.CURRENT_DIRECTORY_SEGMENT ||
        segment === OPENWAGGLE_EXTENSION.PATH.RELATIVE_PARENT_SEGMENT,
    )
  ) {
    return 'Must not contain empty, "." or ".." path segments.'
  }

  return true
}
