// @vitest-environment jsdom

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const GITHUB_ISSUES_EXTENSION_ID = 'openwaggle-github-issues-overview'
const CONFIG_KEY = 'github.issues.config'
const SUMMARY_KEY = 'openwaggle.github.issues.summary'
const PROJECT_PATH = '/tmp/openwaggle-project'

interface FixtureBrokerResult {
  readonly ok: true
  readonly value: {
    readonly value: unknown
  }
}

interface FixtureProjectStorage {
  readonly get: (scope: unknown, key: string) => Promise<FixtureBrokerResult>
  readonly set: (scope: unknown, key: string, value: unknown) => Promise<FixtureBrokerResult>
}

interface FixtureMountContext {
  readonly root: HTMLElement
  readonly projectPaths: readonly string[]
  readonly surface?: {
    readonly payload?: unknown
  }
  readonly sdk: {
    readonly storage: {
      readonly packageConfig: {
        readonly project: FixtureProjectStorage
      }
      readonly packageState: {
        readonly project: FixtureProjectStorage
      }
    }
    readonly openWaggle: {
      readonly actions: {
        readonly openExternal: (url: string) => Promise<void>
      }
    }
  }
}

interface FixtureModule {
  readonly mount: (context: FixtureMountContext) => Promise<void>
}

interface FixturePiTool {
  readonly name: string
  readonly execute: (
    toolCallId: string,
    params: {
      readonly owner?: string
      readonly repo?: string
      readonly labels?: readonly string[]
    },
  ) => Promise<{
    readonly content: readonly { readonly type: string; readonly text: string }[]
    readonly details: unknown
  }>
}

function fixtureModulePath(relativePath: string) {
  return path.join(
    process.cwd(),
    'fixtures',
    'extensions',
    GITHUB_ISSUES_EXTENSION_ID,
    relativePath,
  )
}

function isFixtureModule(value: unknown): value is FixtureModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mount' in value &&
    typeof value.mount === 'function'
  )
}

function isPiToolModule(value: unknown): value is {
  readonly default: (pi: { readonly registerTool: (tool: FixturePiTool) => void }) => void
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'default' in value &&
    typeof value.default === 'function'
  )
}

async function importFixtureModule(relativePath: string) {
  const importedModule: unknown = await import(pathToFileURL(fixtureModulePath(relativePath)).href)
  if (!isFixtureModule(importedModule)) {
    throw new Error(`Fixture module ${relativePath} must export mount(context).`)
  }
  return importedModule
}

async function importPiTool(relativePath: string) {
  const importedModule: unknown = await import(pathToFileURL(fixtureModulePath(relativePath)).href)
  if (!isPiToolModule(importedModule)) {
    throw new Error(`Pi fixture module ${relativePath} must export a default extension factory.`)
  }

  const registeredTools: FixturePiTool[] = []
  importedModule.default({
    registerTool: (tool) => {
      registeredTools.push(tool)
    },
  })
  const registeredTool = registeredTools[0]
  if (!registeredTool) {
    throw new Error(`Pi fixture module ${relativePath} must register a tool.`)
  }
  return registeredTool
}

function successfulStorageResult(value: unknown): FixtureBrokerResult {
  return {
    ok: true,
    value: { value },
  }
}

function projectStorage(store: Map<string, unknown>): FixtureProjectStorage {
  return {
    get: async (_scope, key) => successfulStorageResult(store.get(key) ?? null),
    set: async (_scope, key, value) => {
      store.set(key, value)
      return successfulStorageResult(value)
    },
  }
}

function createContext() {
  const configStore = new Map<string, unknown>([
    [
      CONFIG_KEY,
      {
        owner: 'OpenWaggle',
        repo: 'OpenWaggle',
        labels: ['enhancement', 'ready-for-agent'],
      },
    ],
  ])
  const stateStore = new Map<string, unknown>()
  const openExternalMock = vi.fn(async (_url: string) => {})
  const context: FixtureMountContext = {
    root: document.createElement('div'),
    projectPaths: [PROJECT_PATH],
    sdk: {
      storage: {
        packageConfig: {
          project: projectStorage(configStore),
        },
        packageState: {
          project: projectStorage(stateStore),
        },
      },
      openWaggle: {
        actions: {
          openExternal: openExternalMock,
        },
      },
    },
  }

  return { context, openExternalMock, stateStore }
}

function metricValues(root: ParentNode) {
  return Array.from(root.querySelectorAll('.metric strong')).map((node) => node.textContent)
}

function githubIssuesResponse() {
  return new Response(
    JSON.stringify([
      {
        number: 113,
        title: 'Implement extension host',
        html_url: 'https://github.com/OpenWaggle/OpenWaggle/issues/113',
        updated_at: '2026-06-03T10:00:00Z',
        labels: [{ name: 'enhancement' }, { name: 'ready-for-agent' }],
      },
      {
        number: 96,
        title: 'Stale issue',
        html_url: 'https://github.com/OpenWaggle/OpenWaggle/issues/96',
        updated_at: '2026-04-01T10:00:00Z',
        labels: [{ name: 'enhancement' }],
      },
      {
        number: 114,
        title: 'Pull request returned by the issues API',
        updated_at: '2026-04-01T10:00:00Z',
        labels: [{ name: 'ready-for-agent' }],
        pull_request: {},
      },
    ]),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

describe('GitHub Issues Overview extension runtime fixture', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders live GitHub issue counts in the side panel', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-04T12:00:00Z') })
    const fetchMock = vi.fn<typeof fetch>(async () => githubIssuesResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { context, openExternalMock, stateStore } = createContext()
    const sidePanelModule = await importFixtureModule('modules/side-panel.js')

    await sidePanelModule.mount(context)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'https://api.github.com/repos/OpenWaggle/OpenWaggle/issues',
    )
    expect(metricValues(context.root)).toEqual(['2', '1', '1'])
    expect(context.root.textContent).toContain('Updated from GitHub')
    expect(stateStore.get(SUMMARY_KEY)).toMatchObject({
      repository: 'OpenWaggle/OpenWaggle',
      open: 2,
      stale: 1,
      ready: 1,
      issues: [
        expect.objectContaining({
          number: 113,
          title: 'Implement extension host',
        }),
        expect.objectContaining({
          number: 96,
          title: 'Stale issue',
        }),
      ],
    })
    expect(context.root.textContent).toContain('#113 Implement extension host')

    const issueLink = context.root.querySelector('a.issue')
    if (!(issueLink instanceof HTMLAnchorElement)) {
      throw new Error('Expected the first issue row to render as a link.')
    }
    expect(issueLink.href).toBe('https://github.com/OpenWaggle/OpenWaggle/issues/113')

    issueLink.click()

    await vi.waitFor(() => {
      expect(openExternalMock).toHaveBeenCalledWith(
        'https://github.com/OpenWaggle/OpenWaggle/issues/113',
      )
    })
  })

  it('shares stored GitHub issue state with agent-loop renderer modules', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-04T12:00:00Z') })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => githubIssuesResponse()),
    )
    const { context } = createContext()
    const sidePanelModule = await importFixtureModule('modules/side-panel.js')
    await sidePanelModule.mount(context)

    const toolContext: FixtureMountContext = {
      ...context,
      root: document.createElement('div'),
      surface: {
        payload: {
          surface: 'tool',
          toolCall: {
            name: 'openwaggle.github.listIssues',
            state: 'input-complete',
          },
        },
      },
    }
    const toolModule = await importFixtureModule('modules/tool-card.js')

    await toolModule.mount(toolContext)

    expect(toolContext.root.textContent).toContain('GitHub issues')
    expect(toolContext.root.textContent).toContain('2 open, 1 ready-for-agent, 1 stale')
    expect(toolContext.root.textContent).toContain('#113 Implement extension host')
  })

  it('registers a Pi-native GitHub issues tool', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-04T12:00:00Z') })
    const fetchMock = vi.fn<typeof fetch>(async () => githubIssuesResponse())
    vi.stubGlobal('fetch', fetchMock)
    const tool = await importPiTool('pi/extensions/github-issues-tool.js')

    const result = await tool.execute('tool-call-1', {
      owner: 'OpenWaggle',
      repo: 'OpenWaggle',
      labels: ['ready-for-agent'],
    })

    expect(tool.name).toBe('openwaggle.github.listIssues')
    expect(result.content[0]?.text).toContain('OpenWaggle/OpenWaggle: 2 open')
    expect(result.content[0]?.text).toContain('#113 Implement extension host')
    expect(result.details).toMatchObject({ open: 2, ready: 1, stale: 1 })
  })
})
