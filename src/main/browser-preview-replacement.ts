import type { BrowserPreviewOpenInput, BrowserPreviewState } from '@shared/types/browser-preview'

export function browserPreviewRestorationInput(
  state: BrowserPreviewState,
): BrowserPreviewOpenInput {
  return {
    previewId: state.previewId,
    ownerKey: state.ownerKey,
    profileId: state.profileId,
    url: state.url,
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    visible: false,
    audioMuted: state.audioMuted,
    initialControls: {
      viewport: state.controls.viewport,
      zoomFactor: state.controls.zoomFactor,
      appearance: state.controls.appearance,
    },
  }
}
