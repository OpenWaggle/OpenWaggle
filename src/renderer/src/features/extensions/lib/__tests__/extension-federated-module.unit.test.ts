import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { describe, expect, it } from 'vitest'
import { isFederatedModule } from '../extension-federated-module'
import { createExtensionModuleUrl } from '../extension-module-url'
import { omitKey } from '@/test-utils/omit-key'

const ENTRY: ExtensionContributionRegistryEntry = {
  extensionId: 'sample-extension',
  extensionName: 'Sample Extension',
  extensionVersion: '1.0.0',
  scope: {
    kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
    label: 'Project',
    projectPath: '/tmp/project',
  },
  packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
  manifestPath: '/tmp/project/.openwaggle/extensions/sample-extension/openwaggle.extension.json',
  contentHash: 'abcdef',
  projectPaths: ['/tmp/project'],
  appliesToAllRequestedProjects: true,
  family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SETTINGS_SECTIONS,
  contributionId: 'sample.settings',
  title: 'Sample settings',
  label: 'Sample settings',
  runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
  execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
  entryPath: 'dist/settings.js',
  eligibility: {
    runtimeEnabled: true,
    enabled: true,
    trusted: true,
    sdkCompatible: true,
    updateAvailable: false,
    disabledProjectPaths: [],
  },
  diagnostics: [],
}

/** Electron's extension runtime origin, `originOf('extension-runtime', 'runtime')`. */
const ELECTRON_RUNTIME_BASE = 'openwaggle-extension://runtime'
/** An Electrobun loopback base: a port and the host's capability path. */
const ELECTROBUN_RUNTIME_BASE = 'http://127.0.0.1:49152/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

describe('extension federated module helpers', () => {
  it('creates a protocol URL for package-relative extension modules', () => {
    const moduleUrl = createExtensionModuleUrl(ENTRY, ELECTRON_RUNTIME_BASE)

    expect(moduleUrl).toBe(
      'openwaggle-extension://runtime/module/%2Ftmp%2Fproject%2F.openwaggle%2Fextensions%2Fsample-extension/abcdef/%5B%22%2Ftmp%2Fproject%22%5D/dist/settings.js',
    )
  })

  it('keeps package and hash context when extension modules import relative chunks', () => {
    const moduleUrl = createExtensionModuleUrl(ENTRY, ELECTRON_RUNTIME_BASE)
    if (!moduleUrl) {
      throw new Error('Expected module URL.')
    }

    expect(new URL('./chunk.js', moduleUrl).href).toBe(
      'openwaggle-extension://runtime/module/%2Ftmp%2Fproject%2F.openwaggle%2Fextensions%2Fsample-extension/abcdef/%5B%22%2Ftmp%2Fproject%22%5D/dist/chunk.js',
    )
  })

  it('includes session context for session-targeted extension modules', () => {
    const moduleUrl = createExtensionModuleUrl(
      { ...ENTRY, sessionId: 'session-1' },
      ELECTRON_RUNTIME_BASE,
    )

    expect(moduleUrl).toBe(
      'openwaggle-extension://runtime/module/%2Ftmp%2Fproject%2F.openwaggle%2Fextensions%2Fsample-extension/abcdef/%5B%22%2Ftmp%2Fproject%22%5D/__context__/%7B%22sessionId%22%3A%22session-1%22%7D/dist/settings.js',
    )
  })

  it('keeps session context when session modules import relative chunks', () => {
    const moduleUrl = createExtensionModuleUrl(
      { ...ENTRY, sessionId: 'session-1' },
      ELECTRON_RUNTIME_BASE,
    )
    if (!moduleUrl) {
      throw new Error('Expected module URL.')
    }

    expect(new URL('./chunk.js', moduleUrl).href).toBe(
      'openwaggle-extension://runtime/module/%2Ftmp%2Fproject%2F.openwaggle%2Fextensions%2Fsample-extension/abcdef/%5B%22%2Ftmp%2Fproject%22%5D/__context__/%7B%22sessionId%22%3A%22session-1%22%7D/dist/chunk.js',
    )
  })

  it('builds module URLs under an Electrobun loopback base, with chunks under its capability', () => {
    const moduleUrl = createExtensionModuleUrl(
      { ...ENTRY, sessionId: 'session-1' },
      ELECTROBUN_RUNTIME_BASE,
    )
    if (!moduleUrl) {
      throw new Error('Expected module URL.')
    }

    const modulePath =
      '/module/%2Ftmp%2Fproject%2F.openwaggle%2Fextensions%2Fsample-extension/abcdef/%5B%22%2Ftmp%2Fproject%22%5D/__context__/%7B%22sessionId%22%3A%22session-1%22%7D/dist'
    expect(moduleUrl).toBe(`${ELECTROBUN_RUNTIME_BASE}${modulePath}/settings.js`)
    expect(new URL('./chunk.js', moduleUrl).href).toBe(
      `${ELECTROBUN_RUNTIME_BASE}${modulePath}/chunk.js`,
    )
  })

  it('returns null when a visual registry entry has no module entry path', () => {
    expect(createExtensionModuleUrl(omitKey(ENTRY, 'entryPath'), ELECTRON_RUNTIME_BASE)).toBeNull()
  })

  it('identifies modules that export mount(context)', () => {
    expect(isFederatedModule({ mount: () => undefined })).toBe(true)
    expect(isFederatedModule({ mount: 'nope' })).toBe(false)
    expect(isFederatedModule(null)).toBe(false)
  })
})
