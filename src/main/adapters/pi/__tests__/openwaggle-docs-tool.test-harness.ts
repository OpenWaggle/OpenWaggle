/** Discovery views, files, and calls for testing the `openwaggle_docs` tool. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type {
  DocsDiscoveryView,
  ExtensionDocsTopicSummary,
  FirstPartyDocsTopicSummary,
} from '@shared/types/docs'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach } from 'vitest'
import {
  createOpenWaggleDocsToolExtension,
  type OpenWaggleDocsToolServices,
} from '../openwaggle-docs-tool-extension'

let root = ''

/** The fixture's temporary docs root, set up anew for every test. */
export function docsRoot() {
  return root
}

export const EXTENSION_DOC = '# Deploy\nRun the deploy action.'

export function sha256(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

export function firstPartyTopic(
  overrides: Partial<FirstPartyDocsTopicSummary> & Pick<FirstPartyDocsTopicSummary, 'topic'>,
): FirstPartyDocsTopicSummary {
  const relative = `topics/${overrides.topic.replace(':', '/')}.md`
  return {
    source: 'openwaggle',
    group: 'OpenWaggle Docs',
    title: overrides.topic,
    order: 0,
    path: path.join(root, 'first-party.md'),
    bundlePath: relative,
    sourcePath: relative,
    aliases: [],
    keywords: [],
    contentHash: 'hash',
    ...overrides,
  }
}

export function extensionTopic(
  overrides: Partial<ExtensionDocsTopicSummary> = {},
  provenance: Partial<ExtensionDocsTopicSummary['provenance']> = {},
): ExtensionDocsTopicSummary {
  const packagePath = path.join(root, 'acme-deploy')
  const docPath = path.join(packagePath, 'usage.md')
  return {
    topic: 'extension:acme.deploy/usage',
    localTopic: 'usage',
    title: 'Deploy usage',
    path: docPath,
    aliases: ['deploy'],
    keywords: ['deploy'],
    contentHash: sha256(EXTENSION_DOC),
    diagnostics: [],
    ...overrides,
    provenance: {
      extensionId: 'acme.deploy',
      extensionName: 'Acme Deploy',
      extensionVersion: '1.0.0',
      scope: { kind: 'global', label: 'Global' },
      packagePath,
      manifestPath: path.join(packagePath, 'package.json'),
      path: docPath,
      packageContentHash: null,
      trust: 'trusted',
      lifecycle: 'enabled',
      ...provenance,
    },
  }
}

export function discoveryView(extensionTopics = [extensionTopic()]): DocsDiscoveryView {
  return {
    generatedAt: '2026-06-05T00:00:00.000Z',
    bundlePath: root,
    firstPartyTopics: [
      firstPartyTopic({
        topic: 'openwaggle:configuration/mcp',
        title: 'Model Context Protocol',
        description: 'Connect external tools and services to the agent with MCP servers.',
        section: 'Customize',
        order: 5,
        aliases: ['configuration/mcp', 'mcp'],
        keywords: ['mcp', 'servers', 'the', 'how'],
      }),
      firstPartyTopic({
        topic: 'openwaggle:using-openwaggle/hives-and-sessions',
        title: 'Hives and Sessions',
        description: 'Coordinate Worker Sessions from a Queen Session.',
        section: 'Use',
        order: 2,
        path: path.join(root, 'hives.md'),
        aliases: ['using-openwaggle/hives-and-sessions', 'hives'],
        keywords: ['hive', 'hives', 'sessions', 'workers', 'the', 'how'],
      }),
      firstPartyTopic({
        topic: 'openwaggle:configuration/app-settings',
        title: 'App Settings',
        description: 'Everything in the OpenWaggle Settings window.',
        order: 7,
        aliases: ['configuration/app-settings'],
        keywords: ['app', 'settings'],
      }),
      firstPartyTopic({
        topic: 'pi:mcp',
        source: 'pi',
        group: 'Pi Docs',
        title: 'MCP',
        aliases: ['mcp'],
        keywords: ['mcp'],
      }),
      firstPartyTopic({
        topic: 'pi:settings',
        source: 'pi',
        group: 'Pi Docs',
        title: 'Settings',
        order: 1,
        aliases: ['settings'],
        keywords: ['settings'],
      }),
    ],
    extensionTopics,
    diagnostics: [],
  }
}

/** Docs services for Runs that never look a topic up. */
export function stubDocsToolServices(bundlePath: string): OpenWaggleDocsToolServices {
  return {
    bundlePath: () => Effect.succeed(bundlePath),
    availableBundlePath: () => Effect.succeed(bundlePath),
    discover: () => Effect.die('docs discovery is not used by this test'),
  }
}

export function registerTool(
  discover: OpenWaggleDocsToolServices['discover'] = () => Effect.succeed(discoveryView()),
  bundlePath: string | null = root,
): ToolDefinition {
  let tool: ToolDefinition | undefined
  createOpenWaggleDocsToolExtension({
    services: {
      bundlePath: () => Effect.succeed(root),
      availableBundlePath: () => Effect.succeed(root),
      discover,
    },
    projectPath: '/repo',
    bundlePath,
  })(
    fromPartial<ExtensionAPI>({
      registerTool: (registered: ToolDefinition) => {
        tool = registered
      },
      on: () => undefined,
    }),
  )
  if (!tool) throw new Error('Tool was not registered')
  return tool
}

export async function call(tool: ToolDefinition, params: unknown) {
  const result = await tool.execute('call-1', params, undefined, undefined, fromPartial({}))
  const [first] = result.content
  if (first?.type !== 'text') throw new Error('Expected a text result')
  return {
    isError: 'isError' in result && result.isError === true,
    text: first.text,
    details: result.details,
  }
}

export async function callJson(tool: ToolDefinition, params: unknown) {
  const result = await call(tool, params)
  if (result.isError) throw new Error(`Tool failed: ${result.text}`)
  const parsed: unknown = JSON.parse(result.text)
  return parsed
}

export async function callRead(tool: ToolDefinition, params: Record<string, unknown>) {
  const result = await call(tool, { action: 'read', ...params })
  if (result.isError) throw new Error(`Tool failed: ${result.text}`)
  const [header = '', body = ''] = result.text.split('\n\n---\n\n')
  return { header, body, details: result.details }
}

/** Registers the hooks that create and remove the fixture's docs root around each test. */
export function registerDocsToolFixture() {
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'ow-docs-tool-'))
    const hives = Array.from({ length: 3000 }, (_, index) => `Hive line ${index + 1}`).join('\n')
    await mkdir(path.join(root, 'acme-deploy'))
    await Promise.all([
      writeFile(path.join(root, 'hives.md'), hives),
      writeFile(path.join(root, 'first-party.md'), '# MCP'),
      writeFile(path.join(root, 'acme-deploy', 'usage.md'), EXTENSION_DOC),
      writeFile(path.join(root, 'secret.txt'), 'secret'),
    ])
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })
}
