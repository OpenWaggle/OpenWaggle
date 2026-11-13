import type {
  BrowserPreviewOpenInput,
  BrowserPreviewReplacementResult,
  BrowserPreviewState,
} from '@shared/types/browser-preview'
import type { RendererSurface } from '../../ports/desktop-shell/renderer-surfaces'

/** A preview, as capacity replacement sees it. */
interface ReplaceablePreview<Surface extends RendererSurface> {
  readonly owner: { readonly sender: Surface }
  readonly state: BrowserPreviewState
}

interface ReplacementHost<Surface extends RendererSurface, Preview> {
  readonly findOwned: (ownerKey: string, previewId: string) => Preview | undefined
  readonly isLive: (record: Preview) => boolean
  readonly dispose: (record: Preview) => void
  readonly open: (sender: Surface, input: BrowserPreviewOpenInput) => BrowserPreviewState
}

export class BrowserPreviewReplacement<
  Surface extends RendererSurface,
  Preview extends ReplaceablePreview<Surface>,
> {
  private readonly host: ReplacementHost<Surface, Preview>

  constructor(host: ReplacementHost<Surface, Preview>) {
    this.host = host
  }

  replace(sender: Surface, input: BrowserPreviewOpenInput, replacedPreviewId: string) {
    if (input.previewId === replacedPreviewId) {
      throw new Error('A browser preview cannot replace itself for capacity.')
    }
    const replaced = this.host.findOwned(input.ownerKey, replacedPreviewId)
    if (!replaced) {
      return {
        state: this.host.open(sender, input),
        replacedState: null,
      } satisfies BrowserPreviewReplacementResult
    }
    if (!this.host.isLive(replaced) || replaced.owner.sender !== sender) {
      throw new Error('Browser preview replacement is not owned by this renderer.')
    }
    const replacedState = replaced.state
    this.host.dispose(replaced)
    try {
      return {
        state: this.host.open(sender, input),
        replacedState,
      } satisfies BrowserPreviewReplacementResult
    } catch (replacementError) {
      const partial = this.host.findOwned(input.ownerKey, input.previewId)
      if (partial?.owner.sender === sender) this.host.dispose(partial)
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

export function browserPreviewRestorationInput(state: BrowserPreviewState) {
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
  } satisfies BrowserPreviewOpenInput
}
