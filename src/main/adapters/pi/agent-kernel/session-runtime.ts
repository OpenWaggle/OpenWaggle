import {
  type AgentSession,
  type AgentSessionServices,
  type CreateAgentSessionResult,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import type { AgentKernelSessionInput } from '../../../ports/agent-kernel-service'
import { getPiAgentDir, type PiModel } from '../pi-provider-catalog'
import {
  createOpenWaggleAgentSessionFromServices,
  disposeOpenWagglePiSession,
} from '../pi-session-lifecycle'
import {
  createIsolatedPiProjectRuntime,
  createPiProjectModelRuntimeWithoutOpenWaggleExtensions,
  type IsolatedPiProjectModelRuntime,
  type PiProjectRuntimeIsolationOptions,
  type PiRuntimeExtensionIsolationInput,
} from './runtime-extension-isolation'
import { createSessionManagerForSession, resolveSessionProjectPath } from './session-manager'

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
  const projectPath = resolveSessionProjectPath(input.session)
  const { session } = await createSessionWithActivationIsolation({
    operation: 'Pi session initialization',
    extensionIsolation: input,
    runtimeOptions: {
      projectPath,
      modelReference: input.model,
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

export async function createPiSessionRuntime(
  input: AgentKernelSessionInput & PiRuntimeExtensionIsolationInput,
) {
  const projectPath = resolveSessionProjectPath(input.session)
  const initialSessionManager = createSessionManagerForSession(input.session, projectPath)
  const createRuntime: CreateAgentSessionRuntimeFactory = async (options) => {
    const runtimeOptions = {
      projectPath: options.cwd,
      modelReference: input.model,
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
  const sessionManager = SessionManager.create(projectPath)
  return {
    piSessionId: sessionManager.getSessionId(),
    piSessionFile: sessionManager.getSessionFile(),
  }
}
