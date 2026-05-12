import { matchBy } from '@diegogbrisa/ts-match'
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

  return matchBy
    .promise(resolveRootAgents(projectPath), 'status')
    .with('found', (root) => ({
      status: root.status,
      filePath: root.filePath,
      content: root.content,
      error: root.error,
    }))
    .with('missing', 'error', (root) => ({
      status: root.status,
      filePath: root.filePath,
      content: null,
      error: root.error,
    }))
    .exhaustive()
}
