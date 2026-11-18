/**
 * Frames the user engaged stay loaded when they scroll away; parking them would reload the
 * document and reset every local selection the fragment does not restore itself. Each frame is an
 * out-of-process site, so only the most recently engaged few stay pinned.
 */
const MAX_PINNED_VISUALIZATION_FRAMES = 3
const pinnedFrames = new Map<string, () => void>()

export function pinInlineVisualizationFrame(instanceId: string, release: () => void) {
  pinnedFrames.delete(instanceId)
  pinnedFrames.set(instanceId, release)
  while (pinnedFrames.size > MAX_PINNED_VISUALIZATION_FRAMES) {
    const oldest = pinnedFrames.entries().next()
    if (oldest.done) break
    const [oldestId, releaseOldest] = oldest.value
    pinnedFrames.delete(oldestId)
    releaseOldest()
  }
}

export function unpinInlineVisualizationFrame(instanceId: string) {
  pinnedFrames.delete(instanceId)
}

export function clearPinnedInlineVisualizationFramesForTests() {
  pinnedFrames.clear()
}
