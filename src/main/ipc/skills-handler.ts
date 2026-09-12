import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import * as Effect from 'effect/Effect'
import {
  getSkillPreviewOperation,
  listSkillsOperation,
  setSkillEnabledOperation,
} from '../application/skill-operations'
import { loadProjectAgentsInstruction } from '../standards/agents-loader'
import { resolveAgentsChainForPath, resolveAgentsForRun } from '../standards/agents-resolver'
import { hostHandle, typedHandle } from './typed-ipc'

const projectPathSchema = Schema.String.pipe(Schema.minLength(1))

export function registerSkillsHandlers(): void {
  typedHandle('standards:get-status', (_event, rawProjectPath: string) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawProjectPath)
      const agents = yield* Effect.promise(() => loadProjectAgentsInstruction(projectPath))
      return {
        agents: agents.status,
        agentsPath: agents.filePath,
        error: agents.error,
      }
    }),
  )

  typedHandle(
    'standards:get-effective-agents',
    (_event, rawProjectPath: string, rawTargetPath?: string) =>
      Effect.gen(function* () {
        const projectPath = decodeUnknownOrThrow(projectPathSchema, rawProjectPath)
        if (typeof rawTargetPath === 'string' && rawTargetPath.trim().length > 0) {
          return yield* Effect.promise(() => resolveAgentsChainForPath(projectPath, rawTargetPath))
        }
        return yield* Effect.promise(() => resolveAgentsForRun(projectPath, []))
      }),
  )

  hostHandle('skills:list', (_event, rawProjectPath: string) => listSkillsOperation(rawProjectPath))

  hostHandle(
    'skills:set-enabled',
    (_event, rawProjectPath: string, rawSkillId: string, enabled: boolean) =>
      setSkillEnabledOperation(rawProjectPath, rawSkillId, enabled),
  )

  hostHandle('skills:get-preview', (_event, rawProjectPath: string, rawSkillId: string) =>
    getSkillPreviewOperation(rawProjectPath, rawSkillId),
  )
}
