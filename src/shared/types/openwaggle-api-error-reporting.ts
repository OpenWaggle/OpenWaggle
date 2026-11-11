/** How the renderer hands error reports to the main process on Electrobun (ADR 0045, 0064). */
export interface OpenWaggleErrorReportingApi {
  /**
   * One Sentry envelope the renderer's browser SDK serialized. The main process reports its error
   * events after its own scrubbing and Usage statistics check, and drops everything else.
   */
  sendErrorReportEnvelope(envelope: string): void
}
