import type { SessionTitleModelSetting } from '@shared/session-title-model'
import type { SupportedModelId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'
import type { SessionTitleGenerationError } from '../errors'

export interface SessionTitleGenerationRequest {
  /** The Session's project, whose extensions may register the Session or Title model. */
  readonly projectPath: string | null
  /** The Session's own model. Automatic picks a cheaper model from its provider; every choice falls back to it. */
  readonly sessionModel: SupportedModelId | null
  /**
   * The model that answered the Session last. The Session's Runs continue on it when the Session
   * model no longer resolves, such as a virtual model whose extension is gone; so does the title.
   */
  readonly fallbackModel?: SupportedModelId
  /** Automatic or one selected model reference; Off never reaches the generator. */
  readonly titleModel: Exclude<SessionTitleModelSetting, 'off'>
  readonly systemPrompt: string
  readonly prompt: string
  /** A person waits for this title: try a model its provider refused a short while ago (#357). */
  readonly retryRefusedModels?: boolean
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
