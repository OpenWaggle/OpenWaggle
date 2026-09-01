import type { OpenWaggleExtensionColorScheme } from '@shared/extension-theme'
import { createOpenWaggleExtensionTheme } from '@shared/extension-theme'
import { isOpenWaggleStandardAppearanceName } from '@/shared/lib/appearance'

const EMPTY_LENGTH = 0
const FUNCTION_TYPE = 'function'

function canReadRendererCssVariables() {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof window.getComputedStyle === FUNCTION_TYPE
  )
}

function resolveRendererCssVariable(cssVariable: string, fallback: string) {
  const resolved = window.getComputedStyle(document.documentElement).getPropertyValue(cssVariable)
  const trimmed = resolved.trim()
  return trimmed.length === EMPTY_LENGTH ? fallback : trimmed
}

export function createRendererExtensionTheme() {
  if (!canReadRendererCssVariables()) {
    return createOpenWaggleExtensionTheme()
  }

  return createOpenWaggleExtensionTheme({
    colorScheme: rendererColorScheme(),
    resolveCssVariable: resolveRendererCssVariable,
  })
}

function rendererColorScheme(): OpenWaggleExtensionColorScheme {
  const appearance = document.documentElement.getAttribute('data-theme')
  return isOpenWaggleStandardAppearanceName(appearance) ? appearance : 'dark'
}
