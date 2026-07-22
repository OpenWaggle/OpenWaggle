import { createOpenWaggleExtensionTheme } from '@shared/extension-theme'

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
    resolveCssVariable: resolveRendererCssVariable,
  })
}
