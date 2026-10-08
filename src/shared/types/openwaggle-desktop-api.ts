/** Result of a user-attested desktop tools recovery (ADR 0048). */
export type DesktopNativeRecoveryOutcome =
  | { readonly outcome: 'recovered' }
  | { readonly outcome: 'failed'; readonly message: string; readonly retryable: boolean }

/** GUI-local admission state; recovery is the user's explicit attestation, never automatic. */
export interface OpenWaggleDesktopApi {
  getDesktopNativeAdmissionIssue(): Promise<string | null>
  recoverDesktopNativeAdmission(): Promise<DesktopNativeRecoveryOutcome>
}
