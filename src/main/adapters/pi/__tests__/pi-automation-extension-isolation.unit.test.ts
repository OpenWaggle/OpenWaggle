import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { expect, it, vi } from 'vitest'

vi.mock('../../../env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../env')>()
  return {
    ...actual,
    env: { ...actual.env, OPENWAGGLE_AUTOMATION: '1' },
  }
})

import { createPiRuntimeServices } from '../pi-provider-catalog'
import {
  createOpenWaggleGlobalPiResourceLoaderOptions,
  createOpenWagglePiResourceLoaderOptions,
} from '../pi-provider-resources'
import { writeProviderExtension } from './pi-provider-catalog.test-utils'

it('excludes project/user extensions but retains trusted built-ins during automation', async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-automation-'))
  const providerId = 'automation-window-escape-probe'
  const inlineFactory: ExtensionFactory = vi.fn()
  const trustedFactory: ExtensionFactory = vi.fn()
  await writeProviderExtension(projectPath, providerId)

  const services = await createPiRuntimeServices(projectPath, {
    enabledOpenWaggleExtensionPackagePaths: [projectPath],
    extensionFactories: [inlineFactory],
    trustedExtensionFactories: [trustedFactory],
  })

  expect(services.modelRuntime.getProvider(providerId)).toBeUndefined()
  expect(inlineFactory).not.toHaveBeenCalled()
  expect(trustedFactory).toHaveBeenCalledOnce()
  expect(createOpenWaggleGlobalPiResourceLoaderOptions()).toEqual({ noExtensions: true })
  expect(
    createOpenWagglePiResourceLoaderOptions(projectPath, {
      enabledOpenWaggleExtensionPackagePaths: [projectPath],
      extensionFactories: [inlineFactory],
      trustedExtensionFactories: [trustedFactory],
    }),
  ).toMatchObject({
    additionalExtensionPaths: [],
    extensionFactories: [trustedFactory],
    noExtensions: true,
  })
})

it('retains trusted append-system-prompt guidance during automation', () => {
  expect(
    createOpenWagglePiResourceLoaderOptions('/project', {
      systemPromptAppendices: ['Collaborative browser guidance'],
    }),
  ).toMatchObject({
    appendSystemPrompt: ['Collaborative browser guidance'],
    noExtensions: true,
  })
})
