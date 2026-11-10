import path from 'node:path'
import { DESKTOP_SERVICE_LIMITS, type DesktopMutationScope } from '@shared/types/desktop-service'

export class BrowserPreviewMutationFences {
  private readonly held = new Map<symbol, DesktopMutationScope>()

  acquire(scope: DesktopMutationScope): () => void {
    if (scope.kind === 'owner' ? !scope.ownerKey.trim() : !path.isAbsolute(scope.directoryPath)) {
      throw new Error('Browser preview mutation fence has an invalid scope.')
    }
    if (this.held.size >= DESKTOP_SERVICE_LIMITS.fenceRecords) {
      throw new Error('Browser preview mutation fence capacity exceeded.')
    }
    const token = Symbol('browser-preview-mutation')
    this.held.set(token, { ...scope })
    return () => {
      this.held.delete(token)
    }
  }

  assertAllowed(ownerKey: string): void {
    for (const scope of this.held.values()) {
      // The native browser registry has no authoritative owner-to-worktree mapping.
      // A rare path mutation therefore fences all browser admission, without closing
      // unrelated previews or guessing from a renderer-provided working path.
      if (scope.kind === 'path' || scope.ownerKey === ownerKey) {
        throw new Error('Browser previews are fenced for a Session or worktree mutation.')
      }
    }
  }
}
