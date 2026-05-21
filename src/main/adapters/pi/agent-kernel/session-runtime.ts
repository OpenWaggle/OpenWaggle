import {
  type AgentSession,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionRuntime,
  SessionManager,
} from '@mariozechner/pi-coding-agent'
import type { AgentKernelSessionInput } from '../../../ports/agent-kernel-service'
import { createPiProjectModelRuntime, getPiAgentDir } from '../pi-provider-catalog'
import {
  createOpenWaggleAgentSessionFromServices,
  disposeOpenWagglePiSession,
} from '../pi-session-lifecycle'
import { createSessionManagerForSession, resolveSessionProjectPath } from './session-manager'

export type PiSessionOperation<T> = (session: AgentSession) => T | Promise<T>

export async function withPiSession<T>(
  input: AgentKernelSessionInput,
  operation: PiSessionOperation<T>,
) {
  const projectPath = resolveSessionProjectPath(input.session)
  const { model, services } = await createPiProjectModelRuntime({
    projectPath,
    modelReference: input.model,
    ...(input.skillToggles ? { skillToggles: input.skillToggles } : {}),
  })
  const sessionManager = createSessionManagerForSession(input.session, projectPath)
  const { session } = await createOpenWaggleAgentSessionFromServices({
    services,
    model,
    sessionManager,
  })

  try {
    return await operation(session)
  } finally {
    await disposeOpenWagglePiSession(session)
  }
}

export async function createPiSessionRuntime(input: AgentKernelSessionInput) {
  const projectPath = resolveSessionProjectPath(input.session)
  const initialSessionManager = createSessionManagerForSession(input.session, projectPath)
  const createRuntime: CreateAgentSessionRuntimeFactory = async (options) => {
    const { model, services } = await createPiProjectModelRuntime({
      projectPath: options.cwd,
      modelReference: input.model,
      ...(input.skillToggles ? { skillToggles: input.skillToggles } : {}),
    })
    const runtime = await createOpenWaggleAgentSessionFromServices({
      services,
      model,
      sessionManager: options.sessionManager,
      sessionStartEvent: options.sessionStartEvent,
    })

    return {
      ...runtime,
      services,
      diagnostics: services.diagnostics,
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
