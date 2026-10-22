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
  HOST_UI_REVISION_21_ARGUMENT_COUNTS,
  HOST_UI_REVISION_21_REQUIRED_CHANNELS,
  HOST_UI_REVISION_23_REQUIRED_CHANNELS,
  HOST_UI_REVISION_24_AGENT_CHANNELS,
  HOST_UI_REVISION_24_ARGUMENT_COUNTS,
  HOST_UI_REVISION_24_REQUIRED_CHANNELS,
  HOST_UI_REVISION_24_SESSION_CHANNELS,
  HOST_UI_REVISION_25_REQUIRED_CHANNELS,
  type HostBackedGuiChannel,
  type HostUiV1Request,
} from '@shared/types/host-ui-protocol'
import {
  LOCAL_SESSION_ARCHIVED_ITEMS_REVISION,
  LOCAL_SESSION_AUTHORIZATION_GRANTS_REVISION,
  LOCAL_SESSION_COMPACTION_REVISION,
  LOCAL_SESSION_DESKTOP_SERVICE_REVISION,
  LOCAL_SESSION_FOLLOW_UP_EDIT_REVISION,
  LOCAL_SESSION_HOST_CONTROL_REVISION,
  LOCAL_SESSION_LEGACY_HOST_UI_REVISION,
  LOCAL_SESSION_MCP_AUTH_REVISION,
  LOCAL_SESSION_MCP_CONFIGURATION_REVISION,
  LOCAL_SESSION_MCP_HOST_UI_REVISION,
  LOCAL_SESSION_NATIVE_ACTIONS_REVISION,
  LOCAL_SESSION_PROJECT_CATALOG_REVISION,
  LOCAL_SESSION_RESOURCE_HOST_UI_REVISION,
  LOCAL_SESSION_SCHEDULED_TASKS_REVISION,
  LOCAL_SESSION_SESSION_SETTINGS_REVISION,
  LOCAL_SESSION_SOURCE_CONTROL_REVISION,
  LOCAL_SESSION_STEERING_RECEIPT_REVISION,
  LOCAL_SESSION_TITLE_REGENERATION_REVISION,
  LOCAL_SESSION_TURN_DIFF_FILES_REVISION,
  LOCAL_SESSION_UPDATE_REVISION,
  LOCAL_SESSION_WAGGLE_REVISION,
  LOCAL_SESSION_WORKSPACE_AUTHORIZATION_REVISION,
  type LocalSessionCommandPayload,
} from '@shared/types/local-session-protocol'

/** Whether the request passes an argument its channel gained in the revision with `counts`. */
function usesArgumentAddedIn(
  counts: Partial<Record<HostBackedGuiChannel, number>>,
  request: Pick<HostUiV1Request, 'channel' | 'args'>,
) {
  const count = counts[request.channel]
  return count !== undefined && request.args.length >= count
}

/**
 * MCP configuration, Pi session discovery's project removal, and the slash menu's Pi extension
 * commands ship with revision 24.
 */
function requiresRevision24(request: Pick<HostUiV1Request, 'channel' | 'args'>) {
  const { channel } = request
  return (
    HOST_UI_REVISION_24_REQUIRED_CHANNELS.some((candidate) => candidate === channel) ||
    HOST_UI_REVISION_24_SESSION_CHANNELS.some((candidate) => candidate === channel) ||
    HOST_UI_REVISION_24_AGENT_CHANNELS.some((candidate) => candidate === channel) ||
    usesArgumentAddedIn(HOST_UI_REVISION_24_ARGUMENT_COUNTS, request)
  )
}

/** Settings > Archived items ships with revision 25; MCP configuration and more with 24. */
function newestRevisionRequirement(request: Pick<HostUiV1Request, 'channel' | 'args'>) {
  if (HOST_UI_REVISION_25_REQUIRED_CHANNELS.some((candidate) => candidate === request.channel)) {
    return LOCAL_SESSION_ARCHIVED_ITEMS_REVISION
  }
  return requiresRevision24(request) ? LOCAL_SESSION_MCP_CONFIGURATION_REVISION : null
}

/** The revision a Host UI request needs: its channel's, or later for an argument added since. */
export function requiredHostUiRevision(request: Pick<HostUiV1Request, 'channel' | 'args'>) {
  const { channel } = request
  const newest = newestRevisionRequirement(request)
  if (newest !== null) return newest
  if (HOST_UI_REVISION_23_REQUIRED_CHANNELS.some((candidate) => candidate === channel)) {
    return LOCAL_SESSION_SOURCE_CONTROL_REVISION
  }
  if (
    HOST_UI_REVISION_21_REQUIRED_CHANNELS.some((candidate) => candidate === channel) ||
    usesArgumentAddedIn(HOST_UI_REVISION_21_ARGUMENT_COUNTS, request)
  ) {
    return LOCAL_SESSION_SESSION_SETTINGS_REVISION
  }
  if (HOST_UI_REVISION_20_REQUIRED_CHANNELS.some((candidate) => candidate === channel)) {
    return LOCAL_SESSION_TITLE_REGENERATION_REVISION
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

/** Follow-up edit commands (ADR 0044) need a Host that can hold a Follow-up. */
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

const CONTRACT_REVISIONS: Partial<Record<LocalSessionCommandPayload['contract'], number>> = {
  'local-update-v1': LOCAL_SESSION_UPDATE_REVISION,
  'local-host-v1': LOCAL_SESSION_HOST_CONTROL_REVISION,
  'desktop-service-v1': LOCAL_SESSION_DESKTOP_SERVICE_REVISION,
  'local-compaction-v1': LOCAL_SESSION_COMPACTION_REVISION,
  'local-compaction-cancel-v1': LOCAL_SESSION_COMPACTION_REVISION,
  'session-waggle-v1': LOCAL_SESSION_WAGGLE_REVISION,
  'session-waggle-cancel-v1': LOCAL_SESSION_WAGGLE_REVISION,
  'scheduled-tasks-v1': LOCAL_SESSION_SCHEDULED_TASKS_REVISION,
}

function requiredSessionControlRevision(payload: LocalSessionCommandPayload) {
  if (isFollowUpEditCommand(payload)) return LOCAL_SESSION_FOLLOW_UP_EDIT_REVISION
  if (payload.contract !== 'session-control-v2') return undefined
  const { operation } = payload.request.command
  if (operation === 'queue-adopt') return LOCAL_SESSION_SESSION_SETTINGS_REVISION
  if (operation === 'steer' || operation === 'promote') {
    return LOCAL_SESSION_STEERING_RECEIPT_REVISION
  }
  return undefined
}

export function requiredLocalSessionCommandRevision(payload: LocalSessionCommandPayload) {
  const sessionControlRevision = requiredSessionControlRevision(payload)
  if (sessionControlRevision !== undefined) return sessionControlRevision
  if (payload.contract === 'host-ui-v1') return requiredHostUiRevision(payload.request)
  return CONTRACT_REVISIONS[payload.contract]
}
