import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enforceScheduledTaskModel } from '../project-provider-restriction'

describe("a Heartbeat's own model under provider restrictions", () => {
  let projectPath: string

  beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'heartbeat-provider-'))
  })

  afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true })
  })

  const settings = {
    ...DEFAULT_SETTINGS,
    enabledModels: [SupportedModelId('openrouter/deepseek')],
    providerRestrictions: { 'amazon-bedrock': false },
  }

  function enforce(modelId: string | undefined) {
    return Effect.runPromiseExit(enforceScheduledTaskModel({ modelId, projectPath, settings }))
  }

  it('fails the Run when its project refuses the named provider', async () => {
    const exit = await enforce('amazon-bedrock/claude')

    expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : '').toContain(
      'provider "amazon-bedrock"',
    )
  })

  it('lets an allowed model, or a Heartbeat with no model of its own, run', async () => {
    expect(Exit.isSuccess(await enforce('openrouter/deepseek'))).toBe(true)
    expect(Exit.isSuccess(await enforce(undefined))).toBe(true)
  })

  it("applies the project's own settings file, which outranks the app scopes", async () => {
    await fs.mkdir(path.join(projectPath, '.openwaggle'))
    await fs.writeFile(
      path.join(projectPath, '.openwaggle', 'settings.json'),
      JSON.stringify({ providers: { 'amazon-bedrock': true } }),
    )

    expect(Exit.isSuccess(await enforce('amazon-bedrock/claude'))).toBe(true)
  })
})
