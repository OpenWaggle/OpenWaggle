import { MAX_PREVIEWS_PER_OWNER, MAX_PREVIEWS_PER_RENDERER } from './browser-preview-policy'

export function assertBrowserPreviewCapacity(ownerCount: number, rendererCount: number): void {
  if (ownerCount >= MAX_PREVIEWS_PER_OWNER) {
    throw new Error(
      `A browser-preview owner may retain at most ${String(MAX_PREVIEWS_PER_OWNER)} previews.`,
    )
  }
  if (rendererCount >= MAX_PREVIEWS_PER_RENDERER) {
    throw new Error(
      `A renderer may retain at most ${String(MAX_PREVIEWS_PER_RENDERER)} browser previews.`,
    )
  }
}
