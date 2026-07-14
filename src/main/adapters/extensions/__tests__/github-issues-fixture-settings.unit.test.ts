// @vitest-environment jsdom

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const GITHUB_ISSUES_EXTENSION_ID = 'openwaggle-github-issues-overview'
const CONFIG_KEY = 'github.issues.config'
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

  return { configStore, context }
}

function inputByLabel(root: ParentNode, label: string) {
  const labelNode = Array.from(root.querySelectorAll('label')).find(
    (candidate) => candidate.querySelector('span')?.textContent === label,
  )
  const input = labelNode?.querySelector('input')
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Expected settings input for "${label}".`)
  }
  return input
}

function saveButton(root: ParentNode) {
  const button = Array.from(root.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === 'Save configuration',
  )
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Expected settings save button.')
  }
  return button
}

function githubIssuesResponse() {
  return new Response(JSON.stringify([{ number: 113, title: 'Implement extension host' }]))
}

describe('GitHub Issues Overview extension settings fixture', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders configuration instead of another issues overview', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => githubIssuesResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { configStore, context } = createContext()
    const settingsModule = await importFixtureModule('modules/settings.js')

    await settingsModule.mount(context)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(context.root.querySelectorAll('.metric strong')).toHaveLength(0)
    expect(context.root.textContent).toContain('Extension configuration')
    expect(context.root.textContent).toContain('Choose the repository and labels')
    expect(context.root.textContent).not.toContain('#113 Implement extension host')
    expect(inputByLabel(context.root, 'Repository owner').value).toBe('OpenWaggle')
    expect(inputByLabel(context.root, 'Repository name').value).toBe('OpenWaggle')
    expect(inputByLabel(context.root, 'Tracked labels').value).toBe('enhancement, ready-for-agent')

    inputByLabel(context.root, 'Repository owner').value = 'Example'
    inputByLabel(context.root, 'Repository name').value = 'Roadmap'
    inputByLabel(context.root, 'Tracked labels').value = 'bug, needs-triage'
    saveButton(context.root).click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(configStore.get(CONFIG_KEY)).toEqual({
      owner: 'Example',
      repo: 'Roadmap',
      labels: ['bug', 'needs-triage'],
    })
    expect(context.root.textContent).toContain('Configuration saved.')
  })
})
