import type { SessionId } from '@shared/types/brand'
import type { InlineVisualizationReadResult } from '@shared/types/inline-visualization'
import { Context } from 'effect'
import type { Effect as EffectType } from 'effect/Effect'

export interface InlineVisualizationDeletionStage {
  readonly commit: EffectType<void, Error>
  readonly rollback: EffectType<void, Error>
}

export interface InlineVisualizationServiceShape {
  readonly prepareSession: (sessionId: SessionId) => EffectType<string, Error>
  readonly deleteSession: (sessionId: SessionId) => EffectType<void, Error>
  readonly stageSessionDeletion: (
    sessionId: SessionId,
  ) => EffectType<InlineVisualizationDeletionStage, Error>
  readonly readSource: (input: {
    readonly sessionId: SessionId
    readonly sourcePath: string
    readonly workspaceRoots: readonly string[]
  }) => EffectType<InlineVisualizationReadResult, never>
}

export class InlineVisualizationService extends Context.Tag(
  '@openwaggle/InlineVisualizationService',
)<InlineVisualizationService, InlineVisualizationServiceShape>() {}
