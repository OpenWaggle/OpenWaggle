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
import { titleRequestWithinProviderRestrictions } from '../session-title-generation'

function layer(providerRestrictions: Record<string, boolean>) {
  return Layer.succeed(SettingsService, {
    get: () => Effect.succeed({ ...DEFAULT_SETTINGS, providerRestrictions, enabledModels: [] }),
    update: () => Effect.void,
    initialize: () => Effect.void,
    flushForTests: () => Effect.void,
  })
}

const BEDROCK_HAIKU = SupportedModelId('amazon-bedrock/eu.anthropic.claude-haiku-5-5')
const BEDROCK_OPUS = SupportedModelId('amazon-bedrock/eu.anthropic.claude-opus-5-5')
const DEEPSEEK = SupportedModelId('openrouter/deepseek/deepseek-v4.1-flash')
const CLAUDE = SupportedModelId('anthropic/claude-opus-5-5')

describe('a Title request within provider restrictions', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-title-restriction-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  function resolve(
    request: Omit<Parameters<typeof titleRequestWithinProviderRestrictions>[0], 'projectPath'>,
    providerRestrictions: Record<string, boolean> = { 'amazon-bedrock': false },
    projectPath: string | null = temporaryRoot,
  ) {
    return Effect.runPromise(
      titleRequestWithinProviderRestrictions({ ...request, projectPath }).pipe(
        Effect.provide(layer(providerRestrictions)),
      ),
    )
  }

  it('falls back to Automatic when the project disallows the Title model provider', async () => {
    await expect(resolve({ titleModel: BEDROCK_HAIKU, sessionModel: CLAUDE })).resolves.toEqual({
      titleModel: SESSION_TITLE_MODEL_AUTOMATIC,
      sessionModel: CLAUDE,
    })
  })

  it('keeps a Title model the project allows', async () => {
    await expect(resolve({ titleModel: DEEPSEEK, sessionModel: CLAUDE })).resolves.toEqual({
      titleModel: DEEPSEEK,
      sessionModel: CLAUDE,
    })
  })

  it('writes no title on Automatic when the Session model uses a refused provider', async () => {
    await expect(
      resolve({ titleModel: SESSION_TITLE_MODEL_AUTOMATIC, sessionModel: BEDROCK_OPUS }),
    ).resolves.toBeNull()
  })

  it('lets an allowed Title model stand in for a Session model from a refused provider', async () => {
    await expect(resolve({ titleModel: DEEPSEEK, sessionModel: BEDROCK_OPUS })).resolves.toEqual({
      titleModel: DEEPSEEK,
      sessionModel: DEEPSEEK,
    })
  })

  it('drops a fallback model from a refused provider', async () => {
    await expect(
      resolve({
        titleModel: SESSION_TITLE_MODEL_AUTOMATIC,
        sessionModel: CLAUDE,
        fallbackModel: BEDROCK_OPUS,
      }),
    ).resolves.toEqual({ titleModel: SESSION_TITLE_MODEL_AUTOMATIC, sessionModel: CLAUDE })
  })

  it('writes no title when the project settings file cannot be read', async () => {
    await fs.mkdir(path.join(temporaryRoot, '.openwaggle'))
    await fs.writeFile(
      path.join(temporaryRoot, '.openwaggle', 'settings.json'),
      JSON.stringify({ providers: { only: 'openrouter' } }),
    )

    await expect(resolve({ titleModel: DEEPSEEK, sessionModel: CLAUDE }, {})).resolves.toBeNull()
  })

  it('leaves the request alone when the Session has no project', async () => {
    await expect(
      resolve({ titleModel: BEDROCK_HAIKU, sessionModel: BEDROCK_OPUS }, undefined, null),
    ).resolves.toEqual({ titleModel: BEDROCK_HAIKU, sessionModel: BEDROCK_OPUS })
  })
})
