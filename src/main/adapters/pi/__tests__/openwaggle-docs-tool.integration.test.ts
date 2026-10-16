import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { generateInstalledDocs } from '../../../../../scripts/installed-docs-generator'
import { DocsBundleService } from '../../../ports/docs-bundle-service'
import type { ExtensionLifecycleRepositoryShape } from '../../../ports/extension-lifecycle-repository'
import type { ExtensionManagerServiceShape } from '../../../ports/extension-manager-service'

// The packaged layout: the bundle sits at `<resourcesPath>/openwaggle-docs`.
vi.mock('electron', () => ({ app: { isPackaged: true } }))

const { FilesystemDocsBundleLive } = await import('../../filesystem-docs-bundle-service')
const { createOpenWaggleDocsToolExtension } = await import('../openwaggle-docs-tool-extension')
const { createOpenWaggleDocsToolServices } = await import('../openwaggle-docs-tool-services')

let resourcesPath = ''
const originalResourcesPath = process.resourcesPath

function setResourcesPath(value: string) {
  Object.defineProperty(process, 'resourcesPath', { value, configurable: true, writable: true })
}

async function docsServices() {
  const docsBundle = await Effect.runPromise(
    DocsBundleService.pipe(Effect.provide(FilesystemDocsBundleLive)),
  )
  return createOpenWaggleDocsToolServices({
    docsBundle,
    extensionManager: fromPartial<ExtensionManagerServiceShape>({
      listPackages: () => Effect.succeed([]),
    }),
    extensionLifecycle: fromPartial<ExtensionLifecycleRepositoryShape>({}),
  })
}

async function registeredTool() {
  const services = await docsServices()
  const bundlePath = await Effect.runPromise(services.availableBundlePath())
  let tool: ToolDefinition | undefined
  createOpenWaggleDocsToolExtension({ services, projectPath: '/repo', bundlePath })(
    fromPartial<ExtensionAPI>({
      registerTool: (registered: ToolDefinition) => {
        tool = registered
      },
    }),
  )
  if (!tool) throw new Error('Tool was not registered')
  return { tool, bundlePath }
}

async function call(tool: ToolDefinition, params: unknown) {
  const result = await tool.execute('call-1', params, undefined, undefined, fromPartial({}))
  const [first] = result.content
  if (first?.type !== 'text') throw new Error('Expected a text result')
  return { isError: 'isError' in result && result.isError === true, text: first.text }
}

beforeAll(async () => {
  resourcesPath = await mkdtemp(path.join(tmpdir(), 'ow-docs-resources-'))
  await generateInstalledDocs({
    outputRoot: path.join(resourcesPath, 'openwaggle-docs'),
    generatedAt: '2026-06-05T00:00:00.000Z',
  })
})

afterAll(async () => {
  setResourcesPath(originalResourcesPath)
  await rm(resourcesPath, { recursive: true, force: true })
})

describe('openwaggle_docs over the generated installed docs bundle', () => {
  it('answers how Hives work from the packaged bundle without guessing paths', async () => {
    setResourcesPath(resourcesPath)
    const { tool, bundlePath } = await registeredTool()
    expect(bundlePath).toBe(path.join(resourcesPath, 'openwaggle-docs'))
    expect(tool.promptGuidelines?.join('\n')).toContain(JSON.stringify(bundlePath))

    const search = await call(tool, { action: 'search', query: 'how do Hives work', limit: 3 })
    expect(search.isError).toBe(false)
    const searchResult: unknown = JSON.parse(search.text)
    expect(searchResult).toMatchObject({
      results: [{ topic: 'openwaggle:using-openwaggle/hives-and-sessions' }],
    })

    const read = await call(tool, {
      action: 'read',
      topic: 'openwaggle:using-openwaggle/hives-and-sessions',
    })
    expect(read.isError).toBe(false)
    const readResult: unknown = JSON.parse(read.text)
    expect(readResult).toMatchObject({
      source: 'openwaggle',
      path: path.join(bundlePath ?? '', 'topics/openwaggle/using-openwaggle/hives-and-sessions.md'),
      content: expect.stringContaining('Queen'),
    })

    const pi = await call(tool, { action: 'read', topic: 'pi:extensions' })
    const piResult: unknown = JSON.parse(pi.text)
    expect(piResult).toMatchObject({ source: 'pi', path: expect.stringContaining('topics/pi/') })
  })

  it('keeps the Run going when the bundle is missing', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'ow-docs-missing-'))
    try {
      setResourcesPath(empty)
      const { tool, bundlePath } = await registeredTool()
      expect(bundlePath).toBeNull()
      expect(tool.promptGuidelines?.join('\n')).not.toContain(empty)
      const result = await call(tool, { action: 'list' })
      expect(result.isError).toBe(true)
      expect(result.text).toContain(JSON.stringify(path.join(empty, 'openwaggle-docs')))
      expect(result.text).toContain('pnpm docs:generate')
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})
