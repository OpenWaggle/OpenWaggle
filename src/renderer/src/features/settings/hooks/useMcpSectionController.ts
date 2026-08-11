import type {
  McpConfigSourceId,
  McpGetSettingsInput,
  McpScope,
  McpScopeState,
  McpServerPermissionGrant,
  McpServerSummary,
} from '@shared/types/mcp'
import { useEffect, useReducer } from 'react'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'
import {
  getErrorMessage,
  getSelectedSource,
  MCP_SECTION_INITIAL_STATE,
  mcpSectionReducer,
} from './mcp-section-state'

async function readSupportingState(context: McpGetSettingsInput) {
  const [doctor, secrets] = await Promise.allSettled([api.doctorMcp(context), api.listMcpSecrets()])
  return { doctor, secrets }
}

export function useMcpSectionController(projectPath: string | null, sessionId: string | null) {
  const [state, dispatch] = useReducer(mcpSectionReducer, MCP_SECTION_INITIAL_STATE)
  const showToast = useUIStore((store) => store.showToast)
  const { view, selectedSourceId, rawEdits, loadState } = state
  const context = { projectPath, sessionId }

  useEffect(() => {
    let active = true
    const effectContext = { projectPath, sessionId }
    dispatch({ type: 'load:start' })
    void api
      .getMcpSettings(effectContext)
      .then(async (nextView) => {
        if (!active) return
        dispatch({ type: 'load:success', view: nextView })
        const supportingState = await readSupportingState(effectContext)
        if (!active) return
        if (supportingState.doctor.status === 'fulfilled') {
          dispatch({ type: 'doctor:success', doctor: supportingState.doctor.value })
        } else {
          dispatch({
            type: 'mutation:error',
            error: getErrorMessage(supportingState.doctor.reason),
          })
        }
        if (supportingState.secrets.status === 'fulfilled') {
          dispatch({ type: 'secrets:success', secrets: supportingState.secrets.value })
        } else {
          dispatch({
            type: 'mutation:error',
            error: getErrorMessage(supportingState.secrets.reason),
          })
        }
      })
      .catch((loadError: unknown) => {
        if (active) dispatch({ type: 'load:error', error: getErrorMessage(loadError) })
      })
    return () => {
      active = false
    }
  }, [projectPath, sessionId])

  async function refresh() {
    dispatch({ type: 'load:start' })
    try {
      dispatch({ type: 'load:success', view: await api.getMcpSettings(context) })
      const supportingState = await readSupportingState(context)
      if (supportingState.doctor.status === 'fulfilled') {
        dispatch({ type: 'doctor:success', doctor: supportingState.doctor.value })
      } else {
        dispatch({ type: 'mutation:error', error: getErrorMessage(supportingState.doctor.reason) })
      }
      if (supportingState.secrets.status === 'fulfilled') {
        dispatch({ type: 'secrets:success', secrets: supportingState.secrets.value })
      } else {
        dispatch({ type: 'mutation:error', error: getErrorMessage(supportingState.secrets.reason) })
      }
    } catch (refreshError) {
      dispatch({ type: 'load:error', error: getErrorMessage(refreshError) })
    }
  }

  async function setScopeState(scope: McpScope, scopeState: McpScopeState) {
    dispatch({ type: 'save:start' })
    try {
      dispatch({
        type: 'mutation:success',
        view: await api.setMcpScopeState({ ...context, scope, state: scopeState }),
      })
    } catch (scopeError) {
      dispatch({ type: 'mutation:error', error: getErrorMessage(scopeError) })
    }
  }

  async function toggleServer(server: McpServerSummary) {
    dispatch({ type: 'save:start' })
    try {
      const nextView = await api.setMcpServerEnabled({
        ...context,
        instanceId: server.instanceId,
        enabled: !server.enabled,
      })
      dispatch({ type: 'mutation:success', view: nextView })
    } catch (toggleError) {
      dispatch({ type: 'mutation:error', error: getErrorMessage(toggleError) })
    }
  }

  async function setServerTrust(
    server: McpServerSummary,
    trusted: boolean,
    allowUnsandboxed = false,
    permissions?: McpServerPermissionGrant,
  ) {
    dispatch({ type: 'save:start' })
    try {
      const nextView = await api.setMcpServerTrust({
        ...context,
        instanceId: server.instanceId,
        trusted,
        ...(allowUnsandboxed ? { allowUnsandboxed: true } : {}),
        ...(permissions ? { permissions } : {}),
      })
      dispatch({ type: 'mutation:success', view: nextView })
      showToast(
        trusted ? `${server.name} is trusted.` : `Trust revoked for ${server.name}.`,
        'success',
      )
    } catch (trustError) {
      dispatch({ type: 'mutation:error', error: getErrorMessage(trustError) })
    }
  }

  async function removeServer(server: McpServerSummary) {
    dispatch({ type: 'save:start' })
    try {
      const nextView = await api.removeMcpServer({ ...context, instanceId: server.instanceId })
      dispatch({ type: 'mutation:success', view: nextView })
      showToast(`${server.name} was removed from ${server.sourceLabel}.`, 'success')
    } catch (removeError) {
      dispatch({ type: 'mutation:error', error: getErrorMessage(removeError) })
    }
  }

  async function authorizeServer(server: McpServerSummary) {
    dispatch({ type: 'save:start' })
    try {
      const result = await api.authorizeMcpServer({ ...context, instanceId: server.instanceId })
      dispatch({ type: 'load:success', view: await api.getMcpSettings(context) })
      showToast(
        result.browserOpened
          ? `${server.name} authorization completed.`
          : `${server.name} already has a usable authorization.`,
        'success',
      )
    } catch (authorizationError) {
      const message = getErrorMessage(authorizationError)
      dispatch({ type: 'mutation:error', error: message })
      showToast(`${server.name} authorization needs attention: ${message}`, 'error')
    }
  }

  async function logoutServer(server: McpServerSummary) {
    dispatch({ type: 'save:start' })
    try {
      await api.logoutMcpServer({ ...context, instanceId: server.instanceId })
      dispatch({ type: 'load:success', view: await api.getMcpSettings(context) })
      showToast(`${server.name} OAuth credentials were removed.`, 'success')
    } catch (logoutError) {
      dispatch({ type: 'mutation:error', error: getErrorMessage(logoutError) })
    }
  }

  async function saveSelectedSource() {
    if (!view) return
    const selectedSource = getSelectedSource(view, selectedSourceId)
    if (!selectedSource) return
    dispatch({ type: 'save:start' })
    try {
      const nextView = await api.writeMcpSourceConfig({
        projectPath,
        sourceId: selectedSource.id,
        rawJson: rawEdits[selectedSource.id] ?? selectedSource.rawJson,
      })
      dispatch({ type: 'source-save:success', view: nextView, sourceId: selectedSource.id })
      showToast('MCP JSON saved.', 'success')
    } catch (saveError) {
      const message = getErrorMessage(saveError)
      dispatch({ type: 'mutation:error', error: message })
      showToast(`MCP JSON was not saved: ${message}`, 'error')
    }
  }

  async function saveSecret(name: string, value: string) {
    dispatch({ type: 'save:start' })
    try {
      const secrets = await api.setMcpSecret({ name, value })
      dispatch({ type: 'secrets:success', secrets })
      dispatch({ type: 'load:success', view: await api.getMcpSettings(context) })
      showToast(`Secret ${name} saved in the encrypted vault.`, 'success')
    } catch (secretError) {
      dispatch({ type: 'mutation:error', error: getErrorMessage(secretError) })
    }
  }

  async function removeSecret(name: string) {
    dispatch({ type: 'save:start' })
    try {
      const secrets = await api.removeMcpSecret({ name })
      dispatch({ type: 'secrets:success', secrets })
      dispatch({ type: 'load:success', view: await api.getMcpSettings(context) })
      showToast(`Secret ${name} removed.`, 'success')
    } catch (secretError) {
      dispatch({ type: 'mutation:error', error: getErrorMessage(secretError) })
    }
  }

  const selectedSource = view ? getSelectedSource(view, selectedSourceId) : null
  const rawJson = selectedSource ? (rawEdits[selectedSource.id] ?? selectedSource.rawJson) : ''

  return {
    view,
    doctor: state.doctor,
    secrets: state.secrets,
    error: state.error,
    selectedSource,
    rawJson,
    busy: loadState !== 'idle',
    refresh,
    setScopeState,
    toggleServer,
    setServerTrust,
    removeServer,
    authorizeServer,
    logoutServer,
    saveSelectedSource,
    saveSecret,
    removeSecret,
    selectSource: (sourceId: McpConfigSourceId) => dispatch({ type: 'source:select', sourceId }),
    updateRawJson: (sourceId: McpConfigSourceId, rawJson: string) =>
      dispatch({ type: 'raw-edit:change', sourceId, rawJson }),
  }
}
