const DEFAULT_QUARANTINE_REASON =
  'The previous desktop did not confirm native resource cleanup. Sessions remain available, but terminals, browser previews, and native cleanup operations are unavailable until ownership can be safely recovered.'
const MAX_REASON_LENGTH = 4096

/** A transport reconnect or lease timeout cannot prove that old native children exited. */
export function makeDesktopNativeAdmission() {
  let issue: string | null = null
  return {
    quarantine(reason: string = DEFAULT_QUARANTINE_REASON) {
      issue ??= reason.trim().slice(0, MAX_REASON_LENGTH) || DEFAULT_QUARANTINE_REASON
    },
    assertAdmission() {
      if (issue !== null) throw new Error(issue)
    },
    getIssue: (): string | null => issue,
  }
}

// This state belongs to the GUI process, not the renderer or detached Session Host.
const admission = makeDesktopNativeAdmission()
export const quarantineDesktopNativeAdmission = admission.quarantine
export const assertDesktopNativeAdmission = admission.assertAdmission
export const getDesktopNativeAdmissionIssue = admission.getIssue
