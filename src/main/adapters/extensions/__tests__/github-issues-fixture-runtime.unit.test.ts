// @vitest-environment jsdom

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const GITHUB_ISSUES_EXTENSION_ID = 'openwaggle-github-issues-overview'
const CONFIG_KEY = 'github.issues.config'
const SUMMARY_KEY = 'github.issues.summary'
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
  readonly sdk: {
    readonly storage: {
      readonly packageConfig: {
        readonly project: FixtureProjectStorage
      }
      readonly packageState: {
        readonly project: FixtureProjectStorage
      }
    }
  }
}

interface FixtureModule {
  readonly mount: (context: FixtureMountContext) => Promise<void>
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

async function importFixtureModule(relativePath: string) {
  const importedModule: unknown = await import(pathToFileURL(fixtureModulePath(relativePath)).href)
  if (!isFixtureModule(importedModule)) {
    throw new Error(`Fixture module ${relativePath} must export mount(context).`)
  }
  return importedModule
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
    },
  }

  return { context, stateStore }
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
        updated_at: '2026-06-03T10:00:00Z',
        labels: [{ name: 'enhancement' }, { name: 'ready-for-agent' }],
      },
      {
        number: 96,
        title: 'Stale issue',
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
    const { context, stateStore } = createContext()
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
    })
  })
})
