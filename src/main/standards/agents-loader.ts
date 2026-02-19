import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentsInstructionStatus } from '@shared/types/standards'

export interface LoadedAgentsInstruction {
  readonly status: AgentsInstructionStatus
  readonly filePath: string
  readonly content: string | null
  readonly error?: string
}

export async function loadAgentsInstruction(
  projectPath: string | null,
): Promise<LoadedAgentsInstruction> {
  const filePath = projectPath ? path.join(projectPath, 'AGENTS.md') : ''
  if (!projectPath) {
    return {
      status: 'missing',
      filePath,
      content: null,
    }
  }

  try {
    const content = await fs.readFile(filePath, 'utf8')
    return {
      status: 'found',
      filePath,
      content,
    }
  } catch (error) {
    if (isMissingError(error)) {
      return {
        status: 'missing',
        filePath,
        content: null,
      }
    }

    return {
      status: 'error',
      filePath,
      content: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function isMissingError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
