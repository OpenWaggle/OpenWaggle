import type { AgentsInstructionStatus } from '@shared/types/standards'
import { resolveRootAgents } from './agents-resolver'

export interface LoadedAgentsInstruction {
  readonly status: AgentsInstructionStatus
  readonly filePath: string
  readonly content: string | null
  readonly error?: string
}

export async function loadProjectAgentsInstruction(
  projectPath: string | null,
): Promise<LoadedAgentsInstruction> {
  if (!projectPath) {
    return {
      status: 'missing',
      filePath: '',
      content: null,
    }
  }

  const root = await resolveRootAgents(projectPath)
  return {
    status: root.status,
    filePath: root.filePath,
    content: root.status === 'found' ? root.content : null,
    error: root.error,
  }
}
