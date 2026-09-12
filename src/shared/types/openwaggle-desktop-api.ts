/** GUI-local admission state; never a grant to take over an uncertain native owner. */
export interface OpenWaggleDesktopApi {
  getDesktopNativeAdmissionIssue(): Promise<string | null>
}
