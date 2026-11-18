import { useEffect, useState } from 'react'
import { useAppearanceName } from '@/shared/hooks/useAppearanceName'
import type { OpenWaggleAppearanceName } from '@/shared/lib/appearance'
import type { McpAppLayout } from './mcp-app-bridge'

/** MCP Apps know two themes; the high-contrast and debug appearances map to their base. */
function appTheme(appearance: OpenWaggleAppearanceName) {
  return appearance === 'light' || appearance === 'high-contrast-light'
    ? ('light' as const)
    : ('dark' as const)
}

/**
 * The width of the element holding an MCP App frame and the app's theme, kept current while the
 * frame is shown, so a running App can lay its data out again when the chat panel is resized or
 * the theme changes.
 */
export function useMcpAppFrameLayout(container: HTMLElement | null) {
  const [width, setWidth] = useState<number | null>(null)
  const theme = appTheme(useAppearanceName())

  useEffect(() => {
    const element = container
    if (!element || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const measured = Math.round(element.getBoundingClientRect().width)
      setWidth((current) => (measured > 0 && measured !== current ? measured : current))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [container])

  return { width, theme } satisfies McpAppLayout
}
