import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type {
  DocsDiscoveryView,
  DocsListInput,
  FirstPartyDocsTopicSummary,
} from '@shared/types/docs'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createOpenWaggleDocsToolExtension,
  type OpenWaggleDocsToolServices,
  openWaggleDocsPromptGuidelines,
} from '../openwaggle-docs-tool-extension'

let root = ''

function firstPartyTopic(
  overrides: Partial<FirstPartyDocsTopicSummary> & Pick<FirstPartyDocsTopicSummary, 'topic'>,
): FirstPartyDocsTopicSummary {
  const relative = `topics/${overrides.topic.replace(':', '/')}.md`
  return {
    source: 'openwaggle',
    group: 'OpenWaggle Docs',
    title: overrides.topic,
    order: 0,
    path: path.join(root, relative),
    bundlePath: relative,
    sourcePath: relative,
    aliases: [],
    keywords: [],
    contentHash: 'hash',
    ...overrides,
  }
}

function discoveryView(): DocsDiscoveryView {
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
        aliases: ['using-openwaggle/hives-and-sessions', 'hives'],
        keywords: ['hive', 'hives', 'sessions', 'workers', 'the', 'how'],
      }),
      firstPartyTopic({
        topic: 'pi:mcp',
        source: 'pi',
        group: 'Pi Docs',
        title: 'MCP',
        order: 0,
        aliases: ['mcp'],
        keywords: ['mcp'],
      }),
    ],
    extensionTopics: [
      {
        topic: 'extension:acme.deploy:usage',
        localTopic: 'usage',
        title: 'Deploy usage',
        path: path.join(root, 'extension-usage.md'),
        aliases: ['deploy'],
        keywords: ['deploy'],
        contentHash: null,
        diagnostics: [],
        provenance: {
          extensionId: 'acme.deploy',
          extensionName: 'Acme Deploy',
          extensionVersion: '1.0.0',
          scope: { kind: 'global', label: 'Global' },
          packagePath: root,
          manifestPath: path.join(root, 'package.json'),
          path: path.join(root, 'extension-usage.md'),
          packageContentHash: null,
          trust: 'trusted',
          lifecycle: 'enabled',
        },
      },
    ],
    diagnostics: [],
  }
}

function services(discover: OpenWaggleDocsToolServices['discover']): OpenWaggleDocsToolServices {
  return {
    bundlePath: () => Effect.succeed(root),
    availableBundlePath: () => Effect.succeed(root),
    discover,
  }
}

function registerTool(
  discover: OpenWaggleDocsToolServices['discover'] = () => Effect.succeed(discoveryView()),
  bundlePath: string | null = root,
) {
  let tool: ToolDefinition | undefined
  createOpenWaggleDocsToolExtension({
    services: services(discover),
    projectPath: '/repo',
    bundlePath,
  })(
    fromPartial<ExtensionAPI>({
      registerTool: (registered: ToolDefinition) => {
        tool = registered
      },
    }),
  )
  if (!tool) throw new Error('Tool was not registered')
  return tool
}

async function call(tool: ToolDefinition, params: unknown) {
  const result = await tool.execute('call-1', params, undefined, undefined, fromPartial({}))
  const [first] = result.content
  if (first?.type !== 'text') throw new Error('Expected a text result')
  return { isError: 'isError' in result && result.isError === true, text: first.text }
}

async function callJson(tool: ToolDefinition, params: unknown) {
  const result = await call(tool, params)
  if (result.isError) throw new Error(`Tool failed: ${result.text}`)
  const parsed: unknown = JSON.parse(result.text)
  return parsed
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ow-docs-tool-'))
  const hives = Array.from({ length: 3000 }, (_, index) => `Hive line ${index + 1}`).join('\n')
  await Promise.all([
    writeFile(path.join(root, 'hives.md'), hives),
    writeFile(path.join(root, 'extension-usage.md'), '# Deploy\nRun the deploy action.'),
  ])
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function viewWithHivesFile() {
  const view = discoveryView()
  return {
    ...view,
    firstPartyTopics: view.firstPartyTopics.map((topic) =>
      topic.topic === 'openwaggle:using-openwaggle/hives-and-sessions'
        ? { ...topic, path: path.join(root, 'hives.md') }
        : topic,
    ),
  }
}

describe('openwaggle_docs tool', () => {
  it('registers a flat schema and points the prompt at the bundle', () => {
    const tool = registerTool()
    expect(tool.name).toBe('openwaggle_docs')
    expect(tool.parameters).toMatchObject({
      type: 'object',
      required: ['action'],
      properties: {
        action: { anyOf: [{ const: 'list' }, { const: 'search' }, { const: 'read' }] },
      },
    })
    expect(tool.parameters).not.toHaveProperty('anyOf')
    expect(tool.promptSnippet).toContain('OpenWaggle')
    const guidelines = tool.promptGuidelines ?? []
    expect(guidelines.join('\n')).toContain(JSON.stringify(root))
    expect(guidelines.join('\n')).toContain('topics/pi/')
    expect(guidelines.join('\n')).toContain('app.asar')
  })

  it('names no bundle path in the prompt when the bundle is unavailable', () => {
    const guidelines = openWaggleDocsPromptGuidelines(null)
    expect(guidelines).toHaveLength(1)
    expect(guidelines[0]).toContain('openwaggle_docs search')
    expect(registerTool(undefined, null).promptGuidelines).toEqual(guidelines)
  })

  it('finds the Hives topic for a natural question', async () => {
    const tool = registerTool()
    const result = await callJson(tool, { action: 'search', query: 'how do Hives work' })
    expect(result).toMatchObject({
      results: [
        { topic: 'openwaggle:using-openwaggle/hives-and-sessions', title: 'Hives and Sessions' },
      ],
    })
  })

  it('ranks exact aliases first and filters search by source', async () => {
    const tool = registerTool()
    expect(await callJson(tool, { action: 'search', query: 'mcp' })).toMatchObject({
      results: [{ topic: 'openwaggle:configuration/mcp' }, { topic: 'pi:mcp' }],
    })
    expect(await callJson(tool, { action: 'search', query: 'mcp', source: 'pi' })).toEqual({
      query: 'mcp',
      results: [{ topic: 'pi:mcp', title: 'MCP' }],
    })
    expect(await callJson(tool, { action: 'search', query: 'kubernetes' })).toMatchObject({
      results: [],
      hint: expect.stringContaining('list'),
    })
  })

  it('lists topics in source order and asks for extension docs of the Session project', async () => {
    const discover = vi.fn((_input: DocsListInput) => Effect.succeed(discoveryView()))
    const tool = registerTool(discover)
    const listed = await callJson(tool, { action: 'list' })
    expect(discover).toHaveBeenCalledWith({ projectPaths: ['/repo'], includeExtensions: true })
    expect(listed).toMatchObject({
      bundlePath: root,
      topics: [
        { topic: 'openwaggle:using-openwaggle/hives-and-sessions' },
        { topic: 'openwaggle:configuration/mcp' },
        { topic: 'pi:mcp' },
        { topic: 'extension:acme.deploy:usage', extension: { id: 'acme.deploy' } },
      ],
    })

    await callJson(tool, { action: 'list', source: 'pi' })
    expect(discover).toHaveBeenLastCalledWith({ projectPaths: ['/repo'], includeExtensions: false })
  })

  it('reads a topic by id, unprefixed id, or alias and pages long docs', async () => {
    const tool = registerTool(() => Effect.succeed(viewWithHivesFile()))
    const first = await callJson(tool, {
      action: 'read',
      topic: 'openwaggle:using-openwaggle/hives-and-sessions',
    })
    expect(first).toMatchObject({
      topic: 'openwaggle:using-openwaggle/hives-and-sessions',
      source: 'openwaggle',
      startLine: 1,
      endLine: 2000,
      totalLines: 3000,
      nextOffset: 2001,
    })
    const rest = await callJson(tool, {
      action: 'read',
      topic: 'using-openwaggle/hives-and-sessions',
      offset: 2001,
    })
    expect(rest).toMatchObject({ startLine: 2001, endLine: 3000, totalLines: 3000 })
    expect(rest).not.toHaveProperty('nextOffset')
    expect(await callJson(tool, { action: 'read', topic: 'Hives' })).toMatchObject({
      topic: 'openwaggle:using-openwaggle/hives-and-sessions',
    })
  })

  it('reports other topics an ambiguous alias names and reads extension docs with provenance', async () => {
    const tool = registerTool(() => Effect.succeed(viewWithHivesFile()))
    await writeFile(path.join(root, 'topics-mcp.md'), '# MCP')
    const ambiguous = registerTool(() =>
      Effect.succeed({
        ...discoveryView(),
        firstPartyTopics: discoveryView().firstPartyTopics.map((topic) => ({
          ...topic,
          path: path.join(root, 'topics-mcp.md'),
        })),
      }),
    )
    expect(await callJson(ambiguous, { action: 'read', topic: 'mcp' })).toMatchObject({
      topic: 'openwaggle:configuration/mcp',
      otherMatches: ['pi:mcp'],
      content: '# MCP',
    })
    expect(await callJson(tool, { action: 'read', topic: 'deploy' })).toMatchObject({
      topic: 'extension:acme.deploy:usage',
      source: 'extension',
      extension: { id: 'acme.deploy', trust: 'trusted', lifecycle: 'enabled' },
      content: '# Deploy\nRun the deploy action.',
    })
  })

  it('returns tool errors for unknown topics, bad offsets, and invalid arguments', async () => {
    const tool = registerTool(() => Effect.succeed(viewWithHivesFile()))
    expect(await call(tool, { action: 'read', topic: 'nope' })).toMatchObject({
      isError: true,
      text: expect.stringContaining('search or list'),
    })
    expect(await call(tool, { action: 'read', topic: 'hives', offset: 5000 })).toMatchObject({
      isError: true,
      text: expect.stringContaining('3000 lines'),
    })
    expect(await call(tool, { action: 'search' })).toMatchObject({
      isError: true,
      text: expect.stringContaining('"search"'),
    })
    expect(await call(tool, { action: 'delete' })).toMatchObject({ isError: true })
  })

  it('explains a missing bundle instead of failing the Run', async () => {
    const tool = registerTool(() => Effect.fail(new Error('ENOENT: index.json')), null)
    const result = await call(tool, { action: 'search', query: 'hives' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain(JSON.stringify(root))
    expect(result.text).toContain('pnpm docs:generate')
  })
})
