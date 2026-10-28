// Heavy components stay out of this root index: the eager shell imports it for hooks and state,
// and re-exporting the Summary, change-request and resource surfaces here pulled them into the
// initial renderer graph (renderer-load B8). Import them from
// `@/features/session-summary/components`. Only the light message-image pieces that every
// transcript row renders are exported here.
export {
  SessionMessageImages,
  SessionMessageResourcesProvider,
  useSessionMessageImageResources,
} from './components/SessionMessageImages'
export { useSessionHiveInvalidation } from './hooks/useSessionHiveInvalidation'
export { useSessionResourceOwnerActivation } from './hooks/useSessionResourceOwnerActivation'
export {
  useSessionResourceBackfill,
  useSessionResourceInvalidation,
} from './hooks/useSessionResources'
export type {
  SessionResourceBrowserTarget,
  SessionResourceBrowserView,
} from './model/session-resource-browser'
export { DEFAULT_SESSION_RESOURCE_BROWSER_TARGET } from './model/session-resource-browser'
export type { SessionSummaryPanelState } from './state/session-summary-ui-store'
export {
  isSessionSummaryPanelVisible,
  useSessionSummaryUIStore,
} from './state/session-summary-ui-store'
