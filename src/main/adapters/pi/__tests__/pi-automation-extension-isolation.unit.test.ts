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
  // Only OpenWaggle's provider attribution loads beside the trusted built-ins.
  expect(createOpenWaggleGlobalPiResourceLoaderOptions()).toEqual({
    noExtensions: true,
    extensionFactories: [expect.any(Function)],
  })
  expect(
    createOpenWagglePiResourceLoaderOptions(projectPath, {
      enabledOpenWaggleExtensionPackagePaths: [projectPath],
      extensionFactories: [inlineFactory],
      trustedExtensionFactories: [trustedFactory],
    }),
  ).toMatchObject({
    additionalExtensionPaths: ['builtin:codemode', 'builtin:tool-search'],
    extensionFactories: [
      expect.any(Function),
      expect.objectContaining({ name: 'codemode', builtin: true }),
      expect.objectContaining({ name: 'tool-search', builtin: true }),
      trustedFactory,
    ],
    noExtensions: true,
  })
})

it("keeps Pi's built-in codemode and tool search during automation", async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-automation-'))

  const services = await createPiRuntimeServices(projectPath)

  const tools = services.resourceLoader
    .getExtensions()
    .extensions.flatMap((extension) => [...extension.tools.keys()])
  expect(tools).toEqual(expect.arrayContaining(['codemode', 'tool_search']))
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

it("loads the Run's built-in MCP extension by its builtin path during live QA", async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-live-qa-mcp-'))
  const mcpFactory: ExtensionFactory = vi.fn()
  const mcp = { name: 'mcp', factory: mcpFactory, replaceable: true, builtin: true }
  Object.assign(env, { OPENWAGGLE_AUTOMATION_FIRST_PARTY_EXTENSIONS: '1' })

  try {
    expect(
      createOpenWagglePiResourceLoaderOptions(projectPath, { extensionFactories: [mcp] }),
    ).toMatchObject({
      additionalExtensionPaths: ['builtin:codemode', 'builtin:tool-search', 'builtin:mcp'],
      noExtensions: true,
    })
    await createPiRuntimeServices(projectPath, { extensionFactories: [mcp] })
    expect(mcpFactory).toHaveBeenCalledOnce()
  } finally {
    Reflect.deleteProperty(env, 'OPENWAGGLE_AUTOMATION_FIRST_PARTY_EXTENSIONS')
  }
})

it('loads only the Pi extension files a QA run names explicitly during automation', async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-qa-extension-'))
  const providerId = 'automation-qa-fixture-provider'
  const fixturePath = await writeProviderExtension(projectPath, providerId)
  Object.assign(env, { OPENWAGGLE_AUTOMATION_PI_EXTENSIONS: fixturePath })

  try {
    const services = await createPiRuntimeServices(projectPath)

    expect(services.modelRuntime.getProvider(providerId)).toBeDefined()
  } finally {
    Reflect.deleteProperty(env, 'OPENWAGGLE_AUTOMATION_PI_EXTENSIONS')
  }
})

it('ignores the QA extension files outside automation', async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-not-automation-'))
  // Outside the project and the Pi agent directory, so only the QA variable could load it.
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-qa-fixture-'))
  const providerId = 'not-automation-qa-fixture-provider'
  const fixturePath = await writeProviderExtension(fixtureRoot, providerId)
  vi.stubEnv(
    'PI_CODING_AGENT_DIR',
    await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-agent-')),
  )
  Reflect.deleteProperty(env, 'OPENWAGGLE_AUTOMATION')
  Object.assign(env, { OPENWAGGLE_AUTOMATION_PI_EXTENSIONS: fixturePath })

  try {
    const services = await createPiRuntimeServices(projectPath)

    expect(services.modelRuntime.getProvider(providerId)).toBeUndefined()
    expect(
      createOpenWagglePiResourceLoaderOptions(projectPath).additionalExtensionPaths,
    ).not.toContain(fixturePath)
  } finally {
    Object.assign(env, { OPENWAGGLE_AUTOMATION: '1' })
    Reflect.deleteProperty(env, 'OPENWAGGLE_AUTOMATION_PI_EXTENSIONS')
    vi.unstubAllEnvs()
  }
})
