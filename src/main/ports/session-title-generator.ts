import type { SessionTitleModelSetting } from '@shared/session-title-model'
import type { SupportedModelId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'
import type { SessionTitleGenerationError } from '../errors'

export interface SessionTitleGenerationRequest {
  /** The Session's own model. Automatic picks a cheaper model from its provider; every choice falls back to it. */
  readonly sessionModel: SupportedModelId | null
  /** Automatic or one selected model reference; Off never reaches the generator. */
  readonly titleModel: Exclude<SessionTitleModelSetting, 'off'>
  readonly systemPrompt: string
  readonly prompt: string
}

export interface SessionTitleGenerationResponse {
  readonly text: string
  readonly modelRef: SupportedModelId
}

/** Sends one bounded, tool-free title request to a model and returns its raw text. */
export interface SessionTitleGeneratorShape {
  readonly generate: (
    request: SessionTitleGenerationRequest,
  ) => Effect.Effect<SessionTitleGenerationResponse, SessionTitleGenerationError>
}

export class SessionTitleGenerator extends Context.Tag('@openwaggle/SessionTitleGenerator')<
  SessionTitleGenerator,
  SessionTitleGeneratorShape
>() {}
