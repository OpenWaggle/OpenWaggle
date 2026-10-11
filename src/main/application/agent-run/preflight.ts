import type { SessionDetail } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { makeErrorInfo } from '../../agent/error-classifier'
import { agentDefinitionTogglesForProject } from '../../agents/agent-definition-toggle-settings'
import { SettingsService } from '../../services/settings-service'
import { invokesExtensionCommand } from '../agent-extension-commands'
import { listRuntimeEnabledOpenWaggleExtensionPackagePaths } from '../extension-runtime-service'
import { loadSessionForRun } from '../pi-session-projection-refresh'
import { assignSessionTitleFromUserText } from '../run-handler-utils'
import { isSessionModelRunnable } from '../session-model-availability'
import type { AgentRunInput, AgentRunResult } from './types'

interface AgentRunPreflightSuccess {
  readonly ok: true
  readonly session: SessionDetail
  readonly compactionThresholdPercent: number
  readonly assignedTitle?: string
  readonly skillToggles?: Record<string, boolean>
  readonly agentDefinitionToggles?: Record<string, boolean>
  readonly enabledOpenWaggleExtensionPackagePaths?: readonly string[]
}

interface AgentRunPreflightFailure {
  readonly ok: false
  readonly result: AgentRunResult
}

export function loadAgentRunPreflight(input: AgentRunInput) {
  return Effect.gen(function* () {
    const session = yield* loadSessionForRun(input.sessionId)
    if (!session) return sessionNotFound()

    if (!(yield* isSessionModelRunnable(input.model, session))) return invalidModel(input.model)

    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    // An extension command is not the user's request: the title waits for the first real prompt.
    const invokesCommand =
      session.messages.length === 0 &&
      (yield* invokesExtensionCommand({ session, model: input.model, text: input.payload.text }))
    const assignedTitle = invokesCommand
      ? null
      : yield* assignSessionTitleFromUserText(input.sessionId, session, {
          text: input.payload.text,
          attachments: input.payload.attachments,
          model: input.model,
        })
    if (assignedTitle) {
      yield* Effect.sync(() => input.onTitleAssigned?.(assignedTitle))
    }
    const enabledOpenWaggleExtensionPackagePaths = session.projectPath
      ? yield* listRuntimeEnabledOpenWaggleExtensionPackagePaths(session.projectPath)
      : undefined
    const agentProjectPath = session.projectPath
    const agentDefinitionToggles = agentProjectPath
      ? yield* Effect.promise(() =>
          agentDefinitionTogglesForProject(
            settings.agentDefinitionTogglesByProject,
            agentProjectPath,
          ),
        )
      : undefined

    return {
      ok: true,
      session,
      compactionThresholdPercent: settings.compactionThresholdPercent,
      ...(assignedTitle ? { assignedTitle } : {}),
      ...(enabledOpenWaggleExtensionPackagePaths ? { enabledOpenWaggleExtensionPackagePaths } : {}),
      ...(session.projectPath && settings.skillTogglesByProject[session.projectPath]
        ? { skillToggles: settings.skillTogglesByProject[session.projectPath] }
        : {}),
      ...(agentDefinitionToggles ? { agentDefinitionToggles } : {}),
    } satisfies AgentRunPreflightSuccess
  })
}

function sessionNotFound(): AgentRunPreflightFailure {
  const errorInfo = makeErrorInfo('session-not-found', 'Session not found')
  return {
    ok: false,
    result: { outcome: 'not-found', message: errorInfo.userMessage, code: errorInfo.code },
  }
}

function invalidModel(model: string): AgentRunPreflightFailure {
  return {
    ok: false,
    result: {
      outcome: 'invalid-model',
      message: `Unknown model: ${model}`,
      code: 'invalid-model',
    },
  }
}
