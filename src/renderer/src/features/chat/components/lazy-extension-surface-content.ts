import { lazy } from 'react'

// Extension dialogs and side panels open only on an interaction the user chose to answer there,
// so their surfaces (and the extension frame host) load then, not with the composer
// (renderer-load B8).
export const LazyExtensionDialogSurfaceContent = lazy(() =>
  import('@/features/extensions/components').then((module) => ({
    default: module.ExtensionDialogSurfaceContent,
  })),
)
export const LazyExtensionSidePanelSurfaceContent = lazy(() =>
  import('@/features/extensions/components').then((module) => ({
    default: module.ExtensionSidePanelSurfaceContent,
  })),
)
