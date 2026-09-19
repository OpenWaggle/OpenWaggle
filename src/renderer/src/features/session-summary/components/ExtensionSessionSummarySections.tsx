import {
  type ExtensionSessionSummarySectionsProps,
  SessionScopedExtensionSummarySections,
} from './SessionScopedExtensionSummarySections'

export type { SessionSummaryExtensionSidePanelTarget } from './session-summary-extension-actions'

export function ExtensionSessionSummarySections(props: ExtensionSessionSummarySectionsProps) {
  return <SessionScopedExtensionSummarySections key={props.sessionId} {...props} />
}
