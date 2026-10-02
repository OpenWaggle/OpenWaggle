import {
  HOST_BACKED_MCP_GUI_CHANNELS,
  HOST_UI_REVISION_7_NEW_CHANNELS,
  HOST_UI_REVISION_9_REQUIRED_CHANNELS,
  HOST_UI_REVISION_10_REQUIRED_CHANNELS,
  HOST_UI_REVISION_11_REQUIRED_CHANNELS,
  HOST_UI_REVISION_12_REQUIRED_CHANNELS,
  HOST_UI_REVISION_13_REQUIRED_CHANNELS,
  HOST_UI_REVISION_16_REQUIRED_CHANNELS,
  HOST_UI_REVISION_17_REQUIRED_CHANNELS,
  HOST_UI_REVISION_20_REQUIRED_CHANNELS,
  type HostBackedGuiChannel,
} from '@shared/types/host-ui-protocol'
import {
  LOCAL_SESSION_AUTHORIZATION_GRANTS_REVISION,
  LOCAL_SESSION_COMPACTION_REVISION,
  LOCAL_SESSION_DESKTOP_SERVICE_REVISION,
  LOCAL_SESSION_FOLLOW_UP_EDIT_REVISION,
  LOCAL_SESSION_HOST_CONTROL_REVISION,
  LOCAL_SESSION_LEGACY_HOST_UI_REVISION,
  LOCAL_SESSION_MCP_AUTH_REVISION,
  LOCAL_SESSION_MCP_HOST_UI_REVISION,
  LOCAL_SESSION_NATIVE_ACTIONS_REVISION,
  LOCAL_SESSION_PROJECT_CATALOG_REVISION,
  LOCAL_SESSION_RESOURCE_HOST_UI_REVISION,
  LOCAL_SESSION_SESSION_SETTINGS_REVISION,
  LOCAL_SESSION_STEERING_RECEIPT_REVISION,
  LOCAL_SESSION_TURN_DIFF_FILES_REVISION,
  LOCAL_SESSION_UPDATE_REVISION,
  LOCAL_SESSION_WAGGLE_REVISION,
  LOCAL_SESSION_WORKSPACE_AUTHORIZATION_REVISION,
  type LocalSessionCommandPayload,
} from '@shared/types/local-session-protocol'

export function requiredHostUiRevision(channel: HostBackedGuiChannel) {
  if (HOST_UI_REVISION_20_REQUIRED_CHANNELS.some((candidate) => candidate === channel)) {
    return LOCAL_SESSION_SESSION_SETTINGS_REVISION
  }
  if (HOST_UI_REVISION_17_REQUIRED_CHANNELS.some((candidate) => candidate === channel)) {
    return LOCAL_SESSION_NATIVE_ACTIONS_REVISION
  }
  if (HOST_UI_REVISION_16_REQUIRED_CHANNELS.some((candidate) => candidate === channel)) {
    return LOCAL_SESSION_RESOURCE_HOST_UI_REVISION
  }
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

/** Follow-up edit commands (ADR 0043) need a Host that can hold a Follow-up. */
export function isFollowUpEditCommand(payload: LocalSessionCommandPayload) {
  if (payload.contract === 'local-ui-v1') {
    return payload.request.command.operation === 'renew-follow-up-edit-hold'
  }
  if (payload.contract !== 'session-control-v2') return false
  const { operation } = payload.request.command
  return (
    operation === 'queue-edit-begin' ||
    operation === 'queue-edit-save' ||
    operation === 'queue-edit-cancel'
  )
}

export function requiredLocalSessionCommandRevision(payload: LocalSessionCommandPayload) {
  if (isFollowUpEditCommand(payload)) return LOCAL_SESSION_FOLLOW_UP_EDIT_REVISION
  if (
    payload.contract === 'session-control-v2' &&
    payload.request.command.operation === 'queue-adopt'
  ) {
    return LOCAL_SESSION_SESSION_SETTINGS_REVISION
  }
  if (payload.contract === 'local-update-v1') return LOCAL_SESSION_UPDATE_REVISION
  if (payload.contract === 'local-host-v1') return LOCAL_SESSION_HOST_CONTROL_REVISION
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
