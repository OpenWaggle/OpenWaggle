import type { BrowserPreviewRecordingGrant } from '@shared/types/browser-preview-controls'
import { BROWSER_PREVIEW_CAPTURE_LIMITS } from '@shared/types/browser-preview-controls'
import type { Session, WebContents } from 'electron'

const RECORDING_GRANT_TIMEOUT_MS = 5_000

interface RecordingClaim {
  readonly previewId: string
  readonly owner: WebContents
  readonly target: WebContents
}

export class BrowserPreviewRecordingGrantController {
  private readonly installedSessions = new WeakSet<Session>()
  private pending: RecordingClaim | null = null
  private active: RecordingClaim | null = null
  private expiration: ReturnType<typeof setTimeout> | null = null

  begin(previewId: string, owner: WebContents, target: WebContents): BrowserPreviewRecordingGrant {
    this.assertAvailable(previewId, owner, target)
    this.installDisplayMediaHandler(owner.session)
    this.clearExpiration()
    const claim = { previewId, owner, target }
    this.pending = claim
    this.expiration = setTimeout(() => {
      if (this.pending === claim) this.pending = null
      this.expiration = null
    }, RECORDING_GRANT_TIMEOUT_MS)
    this.expiration.unref()
    return {
      maxBytes: BROWSER_PREVIEW_CAPTURE_LIMITS.RECORDING_BYTES,
      maxDurationMs: BROWSER_PREVIEW_CAPTURE_LIMITS.RECORDING_DURATION_MS,
      maxFrameRate: BROWSER_PREVIEW_CAPTURE_LIMITS.RECORDING_FRAME_RATE,
    }
  }

  finish(previewId: string, owner: WebContents): void {
    if (this.pending?.previewId === previewId && this.pending.owner === owner) {
      this.pending = null
      this.clearExpiration()
    }
    if (this.active?.previewId === previewId && this.active.owner === owner) this.active = null
  }

  disposeOwner(owner: WebContents): void {
    if (this.pending?.owner === owner) {
      this.pending = null
      this.clearExpiration()
    }
    if (this.active?.owner === owner) this.active = null
  }

  private assertAvailable(previewId: string, owner: WebContents, target: WebContents): void {
    if (owner.isDestroyed() || target.isDestroyed()) {
      throw new Error('Browser preview recording requires live owner and preview content.')
    }
    const occupied = this.pending ?? this.active
    if (occupied !== null) {
      throw new Error(
        occupied.previewId === previewId && occupied.owner === owner
          ? 'This browser preview is already being recorded.'
          : `Browser preview "${occupied.previewId}" already owns the recording capture slot.`,
      )
    }
  }

  private installDisplayMediaHandler(session: Session): void {
    if (this.installedSessions.has(session)) return
    this.installedSessions.add(session)
    session.setDisplayMediaRequestHandler((request, callback) => {
      const claim = this.pending
      if (
        claim === null ||
        claim.owner.session !== session ||
        claim.owner.isDestroyed() ||
        claim.target.isDestroyed() ||
        request.frame?.frameTreeNodeId !== claim.owner.mainFrame.frameTreeNodeId
      ) {
        callback({})
        return
      }
      this.pending = null
      this.clearExpiration()
      this.active = claim
      callback({ video: claim.target.mainFrame })
    })
  }

  private clearExpiration(): void {
    if (this.expiration === null) return
    clearTimeout(this.expiration)
    this.expiration = null
  }
}
