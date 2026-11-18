import type { IpcInvokeMethod } from './ipc-api-methods'

/** Result of a user-attested desktop tools recovery (ADR 0049). */
export type DesktopNativeRecoveryOutcome =
  | { readonly outcome: 'recovered' }
  | { readonly outcome: 'failed'; readonly message: string; readonly retryable: boolean }

/** GUI-local admission state; recovery is the user's explicit attestation, never automatic. */
export interface OpenWaggleDesktopApi {
  getDesktopNativeAdmissionIssue: IpcInvokeMethod<'app:get-native-admission-issue'>
  recoverDesktopNativeAdmission: IpcInvokeMethod<'app:recover-native-admission'>
  /** Why this GUI process never sends Usage statistics whatever the Setting says (#356). */
  getUsageStatisticsBlock: IpcInvokeMethod<'app:get-usage-statistics-block'>
}
