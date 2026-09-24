import { match } from '@diegogbrisa/ts-match'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import { actionDefinitionIdSchema } from '@shared/schemas/action-definitions'
import type {
  ActionCatalog,
  PreparationDefinition,
  PreparationProfile,
  PreparationReview,
} from '@shared/types/action-definitions'

export function preparationExecutionKey(definition: PreparationDefinition): string {
  const invocation = match(definition.invocation)
    .with({ type: 'command' }, ({ command, directory }) => ({
      type: 'command',
      command,
      directory,
    }))
    .with({ type: 'task' }, ({ task }) => ({
      type: 'task',
      provider: task.provider,
      source: task.source,
      directory: task.directory,
      task: task.task,
      environment: task.environment ?? null,
    }))
    .exhaustive()
  return JSON.stringify({ profileId: definition.profileId, phase: definition.phase, invocation })
}

const reviewedProfileSchema = Schema.parseJson(
  Schema.Struct({ profileId: actionDefinitionIdSchema }),
)

export function reviewedProfile(
  review: PreparationReview,
  profiles: ActionCatalog['profiles'],
): PreparationReview {
  if (review.profileId) return review
  const parsed = safeDecodeUnknown(reviewedProfileSchema, review.fingerprint)
  if (!parsed.success) return review
  const profileId = parsed.data.profileId
  return {
    ...review,
    profileId,
    profileName: profiles.find(({ definition }) => definition.id === profileId)?.definition.name,
  }
}

export function reviewProfileContext(profileId: string, profiles: readonly PreparationProfile[]) {
  return {
    profileId,
    profileName:
      profiles.find((profile) => profile.id === profileId)?.name ??
      (profileId === 'default' ? 'Default' : profileId),
  }
}

export function preparationReview(
  definition: PreparationDefinition,
  enabled: boolean,
  profileName: string,
): PreparationReview {
  return {
    definitionId: definition.id,
    fingerprint: preparationExecutionKey(definition),
    invocation: definition.invocation,
    enabled,
    profileId: definition.profileId,
    profileName,
  }
}
