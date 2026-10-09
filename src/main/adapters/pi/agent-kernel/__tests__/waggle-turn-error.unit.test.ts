import { type AssistantMessage, fauxAssistantMessage } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import { isRecoverableWaggleTurnError } from '../waggle-turn-error'

function failed(errorMessage: string): AssistantMessage {
  return fauxAssistantMessage('', { stopReason: 'error', errorMessage })
}

describe("a Waggle turn's final error", () => {
  it.each([
    ['a rejected sign-in', '401 Unauthorized: Incorrect API key provided'],
    ['a refused account', '403 Forbidden: your account cannot use this model'],
    ['a missing model', "404 The model 'gpt-9' does not exist or you do not have access to it."],
    [
      'exhausted quota',
      '429 You exceeded your current quota, please check your plan and billing details. insufficient_quota',
    ],
    ['a context overflow', 'prompt is too long: 250000 tokens > 200000 maximum'],
  ])('cannot recover after %s', (_label, errorMessage) => {
    expect(isRecoverableWaggleTurnError(failed(errorMessage))).toBe(false)
  })

  it.each([
    ['an unavailable provider', '503 Service Unavailable'],
    ['a network failure', 'fetch failed'],
    ['a timeout', 'Request timed out'],
  ])('can recover after %s', (_label, errorMessage) => {
    expect(isRecoverableWaggleTurnError(failed(errorMessage))).toBe(true)
  })
})
