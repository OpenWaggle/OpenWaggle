import {
  HOST_BACKED_MCP_GUI_CHANNELS,
  HOST_UI_REVISION_7_NEW_CHANNELS,
  HOST_UI_REVISION_9_REQUIRED_CHANNELS,
  HOST_UI_REVISION_10_REQUIRED_CHANNELS,
  HOST_UI_REVISION_11_REQUIRED_CHANNELS,
  HOST_UI_REVISION_12_REQUIRED_CHANNELS,
  HOST_UI_REVISION_13_REQUIRED_CHANNELS,
  type HostBackedGuiChannel,
} from '@shared/types/host-ui-protocol'
import {
  LOCAL_SESSION_AUTHORIZATION_GRANTS_REVISION,
  LOCAL_SESSION_COMPACTION_REVISION,
  LOCAL_SESSION_DESKTOP_SERVICE_REVISION,
  LOCAL_SESSION_LEGACY_HOST_UI_REVISION,
  LOCAL_SESSION_MCP_AUTH_REVISION,
  LOCAL_SESSION_MCP_HOST_UI_REVISION,
  LOCAL_SESSION_PROJECT_CATALOG_REVISION,
  LOCAL_SESSION_STEERING_RECEIPT_REVISION,
  LOCAL_SESSION_TURN_DIFF_FILES_REVISION,
  LOCAL_SESSION_UPDATE_REVISION,
  LOCAL_SESSION_WAGGLE_REVISION,
  LOCAL_SESSION_WORKSPACE_AUTHORIZATION_REVISION,
  type LocalSessionCommandPayload,
} from '@shared/types/local-session-protocol'

export function requiredHostUiRevision(channel: HostBackedGuiChannel) {
  if (HOST_UI_REVISION_13_REQUIRED_CHANNELS.some((candidate) => candidate === channel)) {
    return LOCAL_SESSION_TURN_DIFF_FILES_REVISION
  }
  if (HOST_UI_REVISION_12_REQUIRED_CHANNELS.some((candidate) => candidate === channel)) {
    return LOCAL_SESSION_PROJECT_CATALOG_REVISION
  }
  if (HOST_UI_REVISION_11_REQUIRED_CHANNELS.some((candidate) => candidate === channel)) {
    return LOCAL_SESSION_DESKTOP_SERVICE_REVISION
  }
  if (HOST_UI_REVISION_10_REQUIRED_CHANNELS.some((candidate) => candidate === channel)) {
    return LOCAL_SESSION_AUTHORIZATION_GRANTS_REVISION
  }
  if (HOST_UI_REVISION_9_REQUIRED_CHANNELS.some((candidate) => candidate === channel)) {
    return LOCAL_SESSION_WORKSPACE_AUTHORIZATION_REVISION
  }
  if (HOST_UI_REVISION_7_NEW_CHANNELS.some((candidate) => candidate === channel)) {
    return LOCAL_SESSION_MCP_AUTH_REVISION
  }
  return HOST_BACKED_MCP_GUI_CHANNELS.some((candidate) => candidate === channel)
    ? LOCAL_SESSION_MCP_HOST_UI_REVISION
    : LOCAL_SESSION_LEGACY_HOST_UI_REVISION
}

export function requiredLocalSessionCommandRevision(payload: LocalSessionCommandPayload) {
  if (payload.contract === 'local-update-v1') return LOCAL_SESSION_UPDATE_REVISION
  if (payload.contract === 'desktop-service-v1') return LOCAL_SESSION_DESKTOP_SERVICE_REVISION
  if (
    payload.contract === 'session-control-v2' &&
    (payload.request.command.operation === 'steer' ||
      payload.request.command.operation === 'promote')
  ) {
    return LOCAL_SESSION_STEERING_RECEIPT_REVISION
  }
  if (payload.contract === 'host-ui-v1') return requiredHostUiRevision(payload.request.channel)
  if (
    payload.contract === 'local-compaction-v1' ||
    payload.contract === 'local-compaction-cancel-v1'
  ) {
    return LOCAL_SESSION_COMPACTION_REVISION
  }
  if (payload.contract === 'session-waggle-v1' || payload.contract === 'session-waggle-cancel-v1') {
    return LOCAL_SESSION_WAGGLE_REVISION
  }
}
