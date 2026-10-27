import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionFactory,
} from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, vi } from 'vitest'

vi.mock('../../../env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../env')>()
  return {
    ...actual,
    env: { ...actual.env, OPENWAGGLE_AUTOMATION: '1' },
  }
})

import { env } from '../../../env'
import { temporaryTestDirectory } from '../../../test-support/temporary-test-directory'
import { createPiRuntimeServices } from '../pi-provider-catalog'
import {
  createOpenWaggleGlobalPiResourceLoaderOptions,
  createOpenWagglePiResourceLoaderOptions,
  SESSION_DIRECTORIES_PROMPT_SECTION,
} from '../pi-provider-resources'
import { writeProviderExtension } from './pi-provider-catalog.test-utils'

it('excludes project/user extensions but retains trusted built-ins during automation', async () => {
  const projectPath = await temporaryTestDirectory('openwaggle-pi-automation-')
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
  // The global runtime loads no extension factories during automation.
  expect(createOpenWaggleGlobalPiResourceLoaderOptions()).toEqual({
    noExtensions: true,
    extensionsOverride: expect.any(Function),
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
      expect.objectContaining({ name: 'codemode', builtin: true }),
      expect.objectContaining({ name: 'tool-search', builtin: true }),
      // The skill listing, which shortens <skills> in the prompt only.
      expect.any(Function),
      trustedFactory,
    ],
    noExtensions: true,
  })
})

it("keeps Pi's built-in codemode and tool search during automation", async () => {
  const projectPath = await temporaryTestDirectory('openwaggle-pi-automation-')

  const services = await createPiRuntimeServices(projectPath)

  const tools = services.resourceLoader
    .getExtensions()
    .extensions.flatMap((extension) => [...extension.tools.keys()])
  expect(tools).toEqual(expect.arrayContaining(['codemode', 'tool_search']))
})

it('retains trusted Session directory guidance during automation, after the stable sections', async () => {
  const options = createOpenWagglePiResourceLoaderOptions('/project', {
    systemPromptAppendices: ['Collaborative browser guidance'],
  })
  // Empty, not absent: Pi then adds no APPEND_SYSTEM.md, as when the appendices were passed here.
  expect(options).toMatchObject({ appendSystemPrompt: [], noExtensions: true })

  const handlers: Array<(event: unknown) => unknown> = []
  for (const extension of options.extensionFactories ?? []) {
    if (typeof extension !== 'function') continue
    await extension(
      fromPartial<ExtensionAPI>({
        on: (name: string, handler: (event: unknown) => unknown) => {
          if (name === 'before_agent_start') handlers.push(handler)
        },
      }),
    )
  }
  const event = fromPartial<BeforeAgentStartEvent>({
    systemPromptOptions: { sections: {}, skills: [], cwd: '/project' },
  })
  for (const handler of handlers) handler(event)

  // A section Pi renders after cwd, not its `addendum` before the project context and skills.
  expect(event.systemPromptOptions.sections).toEqual({
    [SESSION_DIRECTORIES_PROMPT_SECTION]: 'Collaborative browser guidance',
  })
})

it('allows host-owned inline extensions without enabling discovered extensions during live QA', async () => {
  const projectPath = await temporaryTestDirectory('openwaggle-pi-live-qa-')
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
  const projectPath = await temporaryTestDirectory('openwaggle-pi-live-qa-mcp-')
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
  const projectPath = await temporaryTestDirectory('openwaggle-pi-qa-extension-')
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
  const projectPath = await temporaryTestDirectory('openwaggle-pi-not-automation-')
  // Outside the project and the Pi agent directory, so only the QA variable could load it.
  const fixtureRoot = await temporaryTestDirectory('openwaggle-pi-qa-fixture-')
  const providerId = 'not-automation-qa-fixture-provider'
  const fixturePath = await writeProviderExtension(fixtureRoot, providerId)
  vi.stubEnv('PI_CODING_AGENT_DIR', await temporaryTestDirectory('openwaggle-pi-agent-'))
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
