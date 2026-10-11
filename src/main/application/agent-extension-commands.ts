import type { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { AgentKernelService } from '../ports/agent-kernel-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SettingsService } from '../services/settings-service'
import { listRuntimeEnabledOpenWaggleExtensionPackagePaths } from './extension-runtime-service'
import { isSessionModelRunnable } from './session-model-availability'

const logger = createLogger('agent-extension-commands')

/**
 * The command a message invokes, if any, parsed as Pi's `prompt()` does: the message starts with
 * `/`, and the name runs to the first space.
 */
function invokedCommandName(text: string) {
  if (!text.startsWith('/')) return undefined
  const space = text.indexOf(' ')
  return space === -1 ? text.slice(1) : text.slice(1, space)
}

/** The commands a Session's Pi extensions register, with the Session's extensions and skills. */
function sessionExtensionCommands(session: SessionDetail, model: SupportedModelId) {
  return Effect.gen(function* () {
    const settings = yield* (yield* SettingsService).get()
    const skillToggles = session.projectPath
      ? settings.skillTogglesByProject[session.projectPath]
      : undefined
    const enabledOpenWaggleExtensionPackagePaths = session.projectPath
      ? yield* listRuntimeEnabledOpenWaggleExtensionPackagePaths(session.projectPath)
      : undefined
    return yield* (yield* AgentKernelService).listExtensionCommands({
      session,
      model,
      ...(skillToggles ? { skillToggles } : {}),
      ...(enabledOpenWaggleExtensionPackagePaths ? { enabledOpenWaggleExtensionPackagePaths } : {}),
    })
  })
}

/** The commands the slash menu lists for a Session: none while its model cannot run. */
export function listAgentExtensionCommands(input: {
  readonly sessionId: SessionId
  readonly model: SupportedModelId
}) {
  return Effect.gen(function* () {
    const session = yield* (yield* SessionProjectionRepository).getOptional(input.sessionId)
    if (!session || !(yield* isSessionModelRunnable(input.model, session))) return []
    return yield* sessionExtensionCommands(session, input.model)
  })
}

/**
 * Whether a message invokes one of the Session's extension commands, which Pi runs instead of
 * prompting the model. Commands that cannot be listed count as none: the message is then treated
 * as the prompt it most likely is.
 */
export function invokesExtensionCommand(input: {
  readonly session: SessionDetail
  readonly model: SupportedModelId
  readonly text: string
}) {
  const name = invokedCommandName(input.text)
  if (name === undefined) return Effect.succeed(false)
  return sessionExtensionCommands(input.session, input.model).pipe(
    Effect.map((commands) => commands.some((command) => command.name === name)),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        logger.warn('Could not list the extension commands a message may invoke', {
          sessionId: input.session.id,
          error: error instanceof Error ? error.message : String(error),
        })
        return false
      }),
    ),
  )
}
