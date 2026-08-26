import { isRecord } from './internal-validation.js'
import {
  EXTENSION_THEME_COLOR_KEYS,
  EXTENSION_THEME_FOCUS_KEYS,
  EXTENSION_THEME_RADIUS_KEYS,
  EXTENSION_THEME_SHADOW_KEYS,
  EXTENSION_THEME_SPACING_KEYS,
  EXTENSION_THEME_TYPE_SCALE_ENTRY_KEYS,
  EXTENSION_THEME_TYPE_SCALE_KEYS,
  EXTENSION_THEME_TYPOGRAPHY_KEYS,
} from './theme-data.js'
import type { OpenWaggleExtensionTheme } from './theme-types.js'

const THEME_TOKEN_GROUP_KEYS = [
  'color',
  'typography',
  'spacing',
  'radius',
  'shadow',
  'focus',
] as const
const TYPOGRAPHY_GROUP_KEYS = ['sansFamily', 'monoFamily', 'typeScale'] as const

function hasExactKeys(value: unknown, keys: readonly string[]) {
  if (!isRecord(value) || Object.keys(value).length !== keys.length) {
    return false
  }

  for (const key of keys) {
    if (!(key in value)) {
      return false
    }
  }

  return true
}

function hasExactStringKeys(value: unknown, keys: readonly string[]) {
  if (!hasExactKeys(value, keys) || !isRecord(value)) {
    return false
  }

  for (const key of keys) {
    if (typeof value[key] !== 'string') {
      return false
    }
  }

  return true
}

function hasTypeScale(value: unknown) {
  if (!hasExactKeys(value, EXTENSION_THEME_TYPE_SCALE_KEYS) || !isRecord(value)) {
    return false
  }

  for (const role of EXTENSION_THEME_TYPE_SCALE_KEYS) {
    if (!hasExactStringKeys(value[role], EXTENSION_THEME_TYPE_SCALE_ENTRY_KEYS)) {
      return false
    }
  }

  return true
}

function hasTypography(value: unknown) {
  if (!hasExactKeys(value, TYPOGRAPHY_GROUP_KEYS) || !isRecord(value)) {
    return false
  }

  for (const key of EXTENSION_THEME_TYPOGRAPHY_KEYS) {
    if (typeof value[key] !== 'string') {
      return false
    }
  }

  return hasTypeScale(value.typeScale)
}

function hasThemeTokenGroups(value: unknown) {
  return (
    hasExactKeys(value, THEME_TOKEN_GROUP_KEYS) &&
    isRecord(value) &&
    hasExactStringKeys(value.color, EXTENSION_THEME_COLOR_KEYS) &&
    hasTypography(value.typography) &&
    hasExactStringKeys(value.spacing, EXTENSION_THEME_SPACING_KEYS) &&
    hasExactStringKeys(value.radius, EXTENSION_THEME_RADIUS_KEYS) &&
    hasExactStringKeys(value.shadow, EXTENSION_THEME_SHADOW_KEYS) &&
    hasExactStringKeys(value.focus, EXTENSION_THEME_FOCUS_KEYS)
  )
}

export function isOpenWaggleExtensionTheme(value: unknown): value is OpenWaggleExtensionTheme {
  return (
    isRecord(value) &&
    (value.colorScheme === 'dark' || value.colorScheme === 'light') &&
    hasThemeTokenGroups(value.tokens) &&
    hasThemeTokenGroups(value.cssVariables)
  )
}
