import { PatchDiff } from '@pierre/diffs/react'
import type { DiffSyntaxTheme } from '@shared/types/settings'
import { useMemo } from 'react'

/**
 * Live preview for the Syntax theme picker.
 *
 * A name and a sentence cannot answer "what will my diffs look like?", so the
 * preview renders a real patch through the real renderer with the theme applied.
 * It reuses the panel's own `.diff-chrome` token mapping, so add/remove colours,
 * gutters, and line numbers are exactly what the diff panel will show.
 */

// A patch small enough to render instantly, but containing the things a reviewer
// judges a theme by: keywords, a type, strings, numbers, punctuation, and one
// modified line so both the add and the remove colours are visible.
const HEX_MARKER = String.fromCodePoint(35)

const PREVIEW_PATCH = `diff --git a/theme-preview.ts b/theme-preview.ts
--- a/theme-preview.ts
+++ b/theme-preview.ts
@@ -1,5 +1,5 @@
 const themePreview: ThemeConfig = {
-  surface: "sidebar",
-  accent: "${HEX_MARKER}2563eb",
-  contrast: 42,
+  surface: "sidebar-elevated",
+  accent: "${HEX_MARKER}0ea5e9",
+  contrast: 68,
 }
`

interface SyntaxThemePreviewProps {
  readonly theme: DiffSyntaxTheme
}

export function SyntaxThemePreview({ theme }: SyntaxThemePreviewProps) {
  // Stable identity per theme: the renderer re-tokenizes whenever its options
  // object changes, so a fresh literal each render would re-highlight the preview
  // on every unrelated Settings interaction.
  const options = useMemo(
    () => ({ theme, diffStyle: 'unified' as const, overflow: 'wrap' as const }),
    [theme],
  )

  return (
    <div className="diff-chrome overflow-hidden rounded-lg border border-border">
      <PatchDiff patch={PREVIEW_PATCH} options={options} />
    </div>
  )
}
