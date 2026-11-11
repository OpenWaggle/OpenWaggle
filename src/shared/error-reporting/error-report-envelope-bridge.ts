/**
 * Global the preload defines, with the error-reporting switch, to tell the renderer that it hands
 * reports to the main process as Sentry envelopes over the app's IPC
 * (`window.api.sendErrorReportEnvelope`). A module of its own: the renderer's entry reads it at
 * startup, and error-report-constants.ts would bring its policy tables into the initial graph.
 */
export const ERROR_REPORT_ENVELOPE_BRIDGE_GLOBAL = '__OPENWAGGLE_ERROR_REPORT_ENVELOPES__'
