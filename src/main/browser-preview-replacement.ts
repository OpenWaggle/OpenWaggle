import type {
  BrowserPreviewOpenInput,
  BrowserPreviewReplacementResult,
  BrowserPreviewState,
} from '@shared/types/browser-preview'
import type { WebContents } from 'electron'
import type { BrowserPreviewRecord } from './browser-preview-records'

interface ReplacementHost {
  readonly findOwned: (ownerKey: string, previewId: string) => BrowserPreviewRecord | undefined
  readonly isLive: (record: BrowserPreviewRecord) => boolean
  readonly dispose: (record: BrowserPreviewRecord) => void
  readonly open: (sender: WebContents, input: BrowserPreviewOpenInput) => BrowserPreviewState
}

export class BrowserPreviewReplacement {
  constructor(private readonly host: ReplacementHost) {}

  replace(
    sender: WebContents,
    input: BrowserPreviewOpenInput,
    replacedPreviewId: string,
  ): BrowserPreviewReplacementResult {
    if (input.previewId === replacedPreviewId) {
      throw new Error('A browser preview cannot replace itself for capacity.')
    }
    const replaced = this.host.findOwned(input.ownerKey, replacedPreviewId)
    if (!replaced) return { state: this.host.open(sender, input), replacedState: null }
    if (!this.host.isLive(replaced) || replaced.owner.sender !== sender) {
      throw new Error('Browser preview replacement is not owned by this renderer.')
    }
    const replacedState = replaced.state
    this.host.dispose(replaced)
    try {
      return { state: this.host.open(sender, input), replacedState }
    } catch (replacementError) {
      const partial = this.host.findOwned(input.ownerKey, input.previewId)
      if (partial && partial.owner.sender === sender) this.host.dispose(partial)
      try {
        this.host.open(sender, browserPreviewRestorationInput(replacedState))
      } catch (restoreError) {
        throw new AggregateError(
          [replacementError, restoreError],
          'Browser preview replacement and rollback both failed.',
          { cause: restoreError },
        )
      }
      throw replacementError
    }
  }
}

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
