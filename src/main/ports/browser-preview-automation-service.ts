import type { SessionId } from '@shared/types/brand'
import type {
  BrowserPreviewAutomationAppearanceInput,
  BrowserPreviewAutomationAppearanceResult,
  BrowserPreviewAutomationClickInput,
  BrowserPreviewAutomationEvaluateInput,
  BrowserPreviewAutomationNavigateInput,
  BrowserPreviewAutomationOpenInput,
  BrowserPreviewAutomationPressInput,
  BrowserPreviewAutomationRecordingArtifact,
  BrowserPreviewAutomationRecordingStatus,
  BrowserPreviewAutomationResizeInput,
  BrowserPreviewAutomationResizeResult,
  BrowserPreviewAutomationScrollInput,
  BrowserPreviewAutomationSnapshot,
  BrowserPreviewAutomationStatus,
  BrowserPreviewAutomationTarget,
  BrowserPreviewAutomationTypeInput,
  BrowserPreviewAutomationWaitInput,
} from '@shared/types/browser-preview-automation'
import { Context } from 'effect'
import type { Effect as EffectType } from 'effect/Effect'

export interface BrowserPreviewAutomationScope {
  readonly sessionId: SessionId
  readonly workingPath: string
}

export interface BrowserPreviewAutomationServiceShape {
  readonly status: (
    scope: BrowserPreviewAutomationScope,
    input: BrowserPreviewAutomationTarget,
  ) => EffectType<BrowserPreviewAutomationStatus, Error>
  readonly open: (
    scope: BrowserPreviewAutomationScope,
    input: BrowserPreviewAutomationOpenInput,
  ) => EffectType<BrowserPreviewAutomationStatus, Error>
  readonly navigate: (
    scope: BrowserPreviewAutomationScope,
    input: BrowserPreviewAutomationNavigateInput,
  ) => EffectType<BrowserPreviewAutomationStatus, Error>
  readonly resize: (
    scope: BrowserPreviewAutomationScope,
    input: BrowserPreviewAutomationResizeInput,
  ) => EffectType<BrowserPreviewAutomationResizeResult, Error>
  readonly setAppearance: (
    scope: BrowserPreviewAutomationScope,
    input: BrowserPreviewAutomationAppearanceInput,
  ) => EffectType<BrowserPreviewAutomationAppearanceResult, Error>
  readonly snapshot: (
    scope: BrowserPreviewAutomationScope,
    input: BrowserPreviewAutomationTarget,
  ) => EffectType<BrowserPreviewAutomationSnapshot, Error>
  readonly click: (
    scope: BrowserPreviewAutomationScope,
    input: BrowserPreviewAutomationClickInput,
  ) => EffectType<void, Error>
  readonly type: (
    scope: BrowserPreviewAutomationScope,
    input: BrowserPreviewAutomationTypeInput,
  ) => EffectType<void, Error>
  readonly press: (
    scope: BrowserPreviewAutomationScope,
    input: BrowserPreviewAutomationPressInput,
  ) => EffectType<void, Error>
  readonly scroll: (
    scope: BrowserPreviewAutomationScope,
    input: BrowserPreviewAutomationScrollInput,
  ) => EffectType<void, Error>
  readonly evaluate: (
    scope: BrowserPreviewAutomationScope,
    input: BrowserPreviewAutomationEvaluateInput,
  ) => EffectType<unknown, Error>
  readonly waitFor: (
    scope: BrowserPreviewAutomationScope,
    input: BrowserPreviewAutomationWaitInput,
  ) => EffectType<void, Error>
  readonly startRecording: (
    scope: BrowserPreviewAutomationScope,
    input: BrowserPreviewAutomationTarget,
  ) => EffectType<BrowserPreviewAutomationRecordingStatus, Error>
  readonly stopRecording: (
    scope: BrowserPreviewAutomationScope,
    input: BrowserPreviewAutomationTarget,
  ) => EffectType<BrowserPreviewAutomationRecordingArtifact, Error>
}

export class BrowserPreviewAutomationService extends Context.Tag(
  '@openwaggle/BrowserPreviewAutomationService',
)<BrowserPreviewAutomationService, BrowserPreviewAutomationServiceShape>() {}
