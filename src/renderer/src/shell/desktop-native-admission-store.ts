import { create } from 'zustand'
import { api } from '@/shared/lib/ipc'
import { ipcErrorMessage } from '@/shared/lib/ipc-error-message'

export type DesktopNativeAdmissionNotice =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'recovered' }
  | {
      readonly kind: 'quarantined'
      readonly issue: string
      readonly failure: string | null
      readonly recoverable: boolean
      readonly recovering: boolean
    }

interface DesktopNativeAdmissionState {
  readonly loading: 'idle' | 'pending' | 'done'
  readonly notice: DesktopNativeAdmissionNotice
  readonly load: () => void
  readonly recover: () => void
  readonly dismiss: () => void
}

/**
 * GUI-lifetime quarantine state (ADR 0049). One store, not per-component state, so the notice
 * keeps an in-flight recovery and its failure while it moves between the workspace and Settings.
 */
export const useDesktopNativeAdmissionStore = create<DesktopNativeAdmissionState>()((set, get) => ({
  loading: 'idle',
  notice: { kind: 'hidden' },

  load() {
    if (get().loading !== 'idle') return
    set({ loading: 'pending' })
    api.getDesktopNativeAdmissionIssue().then(
      (issue) => {
        set({
          loading: 'done',
          notice:
            issue === null
              ? { kind: 'hidden' }
              : { kind: 'quarantined', issue, failure: null, recoverable: true, recovering: false },
        })
      },
      () => set({ loading: 'done', notice: { kind: 'unreadable' } }),
    )
  },

  recover() {
    const { notice } = get()
    if (notice.kind !== 'quarantined' || notice.recovering || !notice.recoverable) return
    const { issue } = notice
    // Choosing this is the user's attestation that the previous window left nothing running.
    set({ notice: { ...notice, failure: null, recovering: true } })
    const failed = (failure: string, recoverable: boolean) =>
      set({ notice: { kind: 'quarantined', issue, failure, recoverable, recovering: false } })
    api.recoverDesktopNativeAdmission().then(
      (result) => {
        if (result.outcome === 'failed') return failed(result.message, result.retryable)
        // Confirmed in the notice itself, which keeps focus and announces it, rather than a toast.
        set({ notice: { kind: 'recovered' } })
      },
      (error: unknown) => failed(ipcErrorMessage(error), true),
    )
  },

  dismiss() {
    // The quarantine notice is the way out, so only an informational notice can be dismissed.
    const { kind } = get().notice
    if (kind === 'unreadable' || kind === 'recovered') set({ notice: { kind: 'hidden' } })
  },
}))
