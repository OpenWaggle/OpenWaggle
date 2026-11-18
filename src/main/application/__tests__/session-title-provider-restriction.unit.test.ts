import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SESSION_TITLE_MODEL_AUTOMATIC } from '@shared/session-title-model'
import { SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsService } from '../../services/settings-service'
import { titleModelWithinProviderRestrictions } from '../session-title-generation'

function layer(providerRestrictions: Record<string, boolean>) {
  return Layer.succeed(SettingsService, {
    get: () => Effect.succeed({ ...DEFAULT_SETTINGS, providerRestrictions, enabledModels: [] }),
    update: () => Effect.void,
    initialize: () => Effect.void,
    flushForTests: () => Effect.void,
  })
}

describe('Title model within provider restrictions', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-title-restriction-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('falls back to Automatic when the project disallows the Title model provider', async () => {
    const titleModel = await Effect.runPromise(
      titleModelWithinProviderRestrictions(
        SupportedModelId('amazon-bedrock/eu.anthropic.claude-haiku-5-5'),
        temporaryRoot,
      ).pipe(Effect.provide(layer({ 'amazon-bedrock': false }))),
    )

    expect(titleModel).toBe(SESSION_TITLE_MODEL_AUTOMATIC)
  })

  it('keeps a Title model the project allows', async () => {
    const titleModel = await Effect.runPromise(
      titleModelWithinProviderRestrictions(
        SupportedModelId('openrouter/deepseek/deepseek-v4.1-flash'),
        temporaryRoot,
      ).pipe(Effect.provide(layer({ 'amazon-bedrock': false }))),
    )

    expect(titleModel).toBe(SupportedModelId('openrouter/deepseek/deepseek-v4.1-flash'))
  })

  it('keeps the Title model when the Session has no project', async () => {
    const titleModel = await Effect.runPromise(
      titleModelWithinProviderRestrictions(
        SupportedModelId('openrouter/deepseek/deepseek-v4.1-flash'),
        null,
      ).pipe(Effect.provide(layer({ 'amazon-bedrock': false }))),
    )

    expect(titleModel).toBe(SupportedModelId('openrouter/deepseek/deepseek-v4.1-flash'))
  })
})
