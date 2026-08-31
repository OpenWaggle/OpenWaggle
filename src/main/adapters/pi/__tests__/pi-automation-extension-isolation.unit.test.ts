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

import { env } from '../../../env'
import { createPiRuntimeServices } from '../pi-provider-catalog'
import {
  createOpenWaggleGlobalPiResourceLoaderOptions,
  createOpenWagglePiResourceLoaderOptions,
} from '../pi-provider-resources'
import { writeProviderExtension } from './pi-provider-catalog.test-utils'

it('excludes project, additional, inline, and global Pi extensions during automation', async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-automation-'))
  const providerId = 'automation-window-escape-probe'
  const inlineFactory: ExtensionFactory = vi.fn()
  await writeProviderExtension(projectPath, providerId)

  const services = await createPiRuntimeServices(projectPath, {
    enabledOpenWaggleExtensionPackagePaths: [projectPath],
    extensionFactories: [inlineFactory],
  })

  expect(services.modelRuntime.getProvider(providerId)).toBeUndefined()
  expect(inlineFactory).not.toHaveBeenCalled()
  expect(createOpenWaggleGlobalPiResourceLoaderOptions()).toEqual({ noExtensions: true })
  expect(
    createOpenWagglePiResourceLoaderOptions(projectPath, {
      enabledOpenWaggleExtensionPackagePaths: [projectPath],
      extensionFactories: [inlineFactory],
    }),
  ).toMatchObject({
    additionalExtensionPaths: [],
    noExtensions: true,
  })
})

it('allows host-owned inline extensions without enabling discovered extensions during live QA', async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-live-qa-'))
  const providerId = 'automation-live-qa-window-escape-probe'
  const inlineFactory: ExtensionFactory = vi.fn()
  await writeProviderExtension(projectPath, providerId)
  Object.assign(env, { OPENWAGGLE_AUTOMATION_FIRST_PARTY_EXTENSIONS: '1' })

  try {
    const services = await createPiRuntimeServices(projectPath, {
      enabledOpenWaggleExtensionPackagePaths: [projectPath],
      extensionFactories: [inlineFactory],
    })

    expect(services.modelRuntime.getProvider(providerId)).toBeUndefined()
    expect(inlineFactory).toHaveBeenCalledOnce()
  } finally {
    Reflect.deleteProperty(env, 'OPENWAGGLE_AUTOMATION_FIRST_PARTY_EXTENSIONS')
  }
})
