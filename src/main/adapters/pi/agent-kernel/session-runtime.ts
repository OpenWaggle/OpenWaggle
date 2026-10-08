import {
  type AgentSession,
  type AgentSessionServices,
  type CreateAgentSessionResult,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { DEFAULT_COMPACTION_THRESHOLD_PERCENT } from '@shared/types/settings'
import type { AgentKernelSessionInput } from '../../../ports/agent-kernel-service'
import { getPiAgentDir, type PiModel } from '../pi-provider-catalog'
import { resolvePiSessionDirectory } from '../pi-session-directory'
import {
  createOpenWaggleAgentSessionFromServices,
  disposeOpenWagglePiSession,
} from '../pi-session-lifecycle'
import { idleCacheWarming } from './pi-idle-cache-warming'
import {
  createIsolatedPiProjectRuntime,
  createPiProjectModelRuntimeWithoutOpenWaggleExtensions,
  type IsolatedPiProjectModelRuntime,
  type PiProjectRuntimeIsolationOptions,
  type PiRuntimeExtensionIsolationInput,
} from './runtime-extension-isolation'
import {
  createReadOnlySessionManagerForSession,
  createSessionManagerForSession,
  resolveSessionWorkingPath,
} from './session-manager'
import { sessionFallbackModelReference } from './session-model-fallback'

export type PiSessionOperation<T> = (session: AgentSession) => T | Promise<T>

async function createSessionWithActivationIsolation<T>(input: {
  readonly operation: string
  readonly extensionIsolation: PiRuntimeExtensionIsolationInput
  readonly runtimeOptions: PiProjectRuntimeIsolationOptions
  readonly createSession: (runtime: {
    readonly services: AgentSessionServices
    readonly model: PiModel
  }) => Promise<T>
}) {
  const selectedRuntime = await createIsolatedPiProjectRuntime({
    operation: input.operation,
    extensionIsolation: input.extensionIsolation,
    options: input.runtimeOptions,
  })

  try {
    return await input.createSession(selectedRuntime.runtime)
  } catch (error) {
    if (selectedRuntime.enabledOpenWaggleExtensionPackagePaths.length === 0) {
      throw error
    }

    const fallbackRuntime = await createPiProjectModelRuntimeWithoutOpenWaggleExtensions(
      input.runtimeOptions,
    )
    return input.createSession(fallbackRuntime)
  }
}

function sessionRuntimeWithDiagnostics(
  runtime: IsolatedPiProjectModelRuntime,
  sessionRuntime: CreateAgentSessionResult,
) {
  return {
    ...sessionRuntime,
    services: runtime.runtime.services,
    diagnostics: runtime.runtime.services.diagnostics,
  }
}

export async function withPiSession<T>(
  input: AgentKernelSessionInput & PiRuntimeExtensionIsolationInput,
  operation: PiSessionOperation<T>,
) {
  await idleCacheWarming.release(input.session.id)
  const projectPath = resolveSessionWorkingPath(input.session)
  const { session } = await createSessionWithActivationIsolation({
    operation: 'Pi session initialization',
    extensionIsolation: input,
    runtimeOptions: {
      projectPath,
      modelReference: input.model,
      ...sessionFallbackModelReference(input.session),
      compactionThresholdPercent:
        input.compactionThresholdPercent ?? DEFAULT_COMPACTION_THRESHOLD_PERCENT,
      ...(input.skillToggles ? { skillToggles: input.skillToggles } : {}),
    },
    createSession: async ({ services, model }) => {
      const sessionManager = createSessionManagerForSession(input.session, projectPath)
      return createOpenWaggleAgentSessionFromServices({
        services,
        model,
        sessionManager,
      })
    },
  })

  try {
    return await operation(session)
  } finally {
    await disposeOpenWagglePiSession(session)
  }
}

/**
 * Runs a read, such as context usage or a snapshot, against an in-memory copy of the Session's Pi
 * file. Nothing it does reaches the file, and extensions are not bound, so they see no session
 * start or shutdown for a session that is only being looked at. It does not release a warming
 * session either, since it does not open the file.
 */
export async function withReadOnlyPiSession<T>(
  input: AgentKernelSessionInput & PiRuntimeExtensionIsolationInput,
  operation: PiSessionOperation<T>,
) {
  const projectPath = resolveSessionWorkingPath(input.session)
  const sessionManager = await createReadOnlySessionManagerForSession(input.session, projectPath)
  const { session } = await createSessionWithActivationIsolation({
    operation: 'Pi session read',
    extensionIsolation: input,
    runtimeOptions: {
      projectPath,
      modelReference: input.model,
      ...sessionFallbackModelReference(input.session),
      compactionThresholdPercent:
        input.compactionThresholdPercent ?? DEFAULT_COMPACTION_THRESHOLD_PERCENT,
      ...(input.skillToggles ? { skillToggles: input.skillToggles } : {}),
    },
    createSession: ({ services, model }) =>
      createAgentSessionFromServices({ services, model, sessionManager }),
  })

  try {
    return await operation(session)
  } finally {
    session.dispose()
  }
}

export async function createPiSessionRuntime(
  input: AgentKernelSessionInput & PiRuntimeExtensionIsolationInput,
) {
  await idleCacheWarming.release(input.session.id)
  const projectPath = resolveSessionWorkingPath(input.session)
  const initialSessionManager = createSessionManagerForSession(input.session, projectPath)
  const createRuntime: CreateAgentSessionRuntimeFactory = async (options) => {
    const runtimeOptions = {
      projectPath: options.cwd,
      modelReference: input.model,
      ...sessionFallbackModelReference(input.session),
      compactionThresholdPercent:
        input.compactionThresholdPercent ?? DEFAULT_COMPACTION_THRESHOLD_PERCENT,
      ...(input.skillToggles ? { skillToggles: input.skillToggles } : {}),
    } satisfies PiProjectRuntimeIsolationOptions
    const selectedRuntime = await createIsolatedPiProjectRuntime({
      operation: 'Pi reusable session runtime initialization',
      extensionIsolation: input,
      options: runtimeOptions,
    })

    try {
      const sessionRuntime = await createOpenWaggleAgentSessionFromServices({
        services: selectedRuntime.runtime.services,
        model: selectedRuntime.runtime.model,
        sessionManager: options.sessionManager,
        sessionStartEvent: options.sessionStartEvent,
      })

      return sessionRuntimeWithDiagnostics(selectedRuntime, sessionRuntime)
    } catch (error) {
      if (selectedRuntime.enabledOpenWaggleExtensionPackagePaths.length === 0) {
        throw error
      }

      const fallbackRuntime =
        await createPiProjectModelRuntimeWithoutOpenWaggleExtensions(runtimeOptions)
      const sessionRuntime = await createOpenWaggleAgentSessionFromServices({
        services: fallbackRuntime.services,
        model: fallbackRuntime.model,
        sessionManager: options.sessionManager,
        sessionStartEvent: options.sessionStartEvent,
      })

      return {
        ...sessionRuntime,
        services: fallbackRuntime.services,
        diagnostics: fallbackRuntime.services.diagnostics,
      }
    }
  }

  return createAgentSessionRuntime(createRuntime, {
    cwd: projectPath,
    agentDir: getPiAgentDir(),
    sessionManager: initialSessionManager,
  })
}

export async function createPiSession(projectPath: string) {
  // Where `pi --resume` looks for this folder's sessions, so it can continue this one too.
  const sessionManager = SessionManager.create(projectPath, resolvePiSessionDirectory(projectPath))
  return {
    piSessionId: sessionManager.getSessionId(),
    piSessionFile: sessionManager.getSessionFile(),
  }
}
