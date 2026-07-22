export const BUILT_IN_COMPOSER_SLASH_COMMAND = {
  COMPACT: '/compact',
  FORK: '/fork',
  CLONE: '/clone',
} as const

export const BUILT_IN_COMPOSER_SLASH_COMMANDS: readonly string[] = Object.freeze(
  Object.values(BUILT_IN_COMPOSER_SLASH_COMMAND),
)
