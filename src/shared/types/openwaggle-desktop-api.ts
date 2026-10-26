import type { UsageStatisticsEnvironmentBlock } from '../usage-statistics/enablement'

/** Result of a user-attested desktop tools recovery (ADR 0049). */
export type DesktopNativeRecoveryOutcome =
  | { readonly outcome: 'recovered' }
  | { readonly outcome: 'failed'; readonly message: string; readonly retryable: boolean }

/** GUI-local admission state; recovery is the user's explicit attestation, never automatic. */
export interface OpenWaggleDesktopApi {
  getDesktopNativeAdmissionIssue(): Promise<string | null>
  recoverDesktopNativeAdmission(): Promise<DesktopNativeRecoveryOutcome>
  /** Why this GUI process never sends Usage statistics whatever the Setting says (#356). */
  getUsageStatisticsBlock(): Promise<UsageStatisticsEnvironmentBlock | null>
}
