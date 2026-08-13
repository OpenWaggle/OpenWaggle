import { jsx as _jsx } from "react/jsx-runtime";
import { PatchDiff } from '@pierre/diffs/react';
import { useMemo } from 'react';
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
const PREVIEW_PATCH = `diff --git a/theme-preview.ts b/theme-preview.ts
--- a/theme-preview.ts
+++ b/theme-preview.ts
@@ -1,5 +1,5 @@
 const themePreview: ThemeConfig = {
-  surface: "sidebar",
-  accent: "#2563eb",
-  contrast: 42,
+  surface: "sidebar-elevated",
+  accent: "#0ea5e9",
+  contrast: 68,
 }
`;
export function SyntaxThemePreview({ theme }) {
    // Stable identity per theme: the renderer re-tokenizes whenever its options
    // object changes, so a fresh literal each render would re-highlight the preview
    // on every unrelated Settings interaction.
    const options = useMemo(() => ({ theme, diffStyle: 'unified', overflow: 'wrap' }), [theme]);
    return (_jsx("div", { className: "diff-chrome overflow-hidden rounded-lg border border-border", children: _jsx(PatchDiff, { patch: PREVIEW_PATCH, options: options }) }));
}
