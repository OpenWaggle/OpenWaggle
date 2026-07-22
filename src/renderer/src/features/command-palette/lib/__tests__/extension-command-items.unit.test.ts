import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { describe, expect, it, vi } from 'vitest'
import {
  createExtensionCommandItems,
  createExtensionSidePanelItems,
  createExtensionSlashCommandItems,
  type ExtensionCommandActionInput,
  type ExtensionSidePanelActionInput,
  type ExtensionSlashCommandActionInput,
  type InsertExtensionSlashCommand,
  type InvokeExtensionCommand,
  type OpenExtensionSidePanel,
  resolveExtensionCommandInvocationScope,
} from '../extension-command-items'

function commandEntry(
  overrides: Partial<ExtensionContributionRegistryEntry> = {},
): ExtensionContributionRegistryEntry {
  return {
    extensionId: 'sample.extension',
    extensionName: 'Sample Extension',
    extensionVersion: '1.0.0',
    scope: {
      kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND,
      label: 'Global',
    },
    packagePath: '/tmp/sample-extension',
    manifestPath: '/tmp/sample-extension/openwaggle.extension.json',
    contentHash: 'abcdef',
    projectPaths: ['/tmp/project'],
    appliesToAllRequestedProjects: true,
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS,
    contributionId: 'sample.run',
    title: 'Run sample command',
    label: 'Run sample command',
    category: 'Sample',
    capability: 'sample.execute',
    method: 'run',
    eligibility: {
      runtimeEnabled: true,
      enabled: true,
      trusted: true,
      sdkCompatible: true,
      updateAvailable: false,
      disabledProjectPaths: [],
    },
    diagnostics: [],
    ...overrides,
  }
}

describe('resolveExtensionCommandInvocationScope', () => {
  it('uses app scope for app-only commands when a project is active', () => {
    const scope = resolveExtensionCommandInvocationScope({
      entry: commandEntry({ declaredScopes: ['app'] }),
      projectPath: '/tmp/project',
    })

    expect(scope).toEqual({ kind: 'app' })
  })

  it('uses project scope for project-capable commands in the active project', () => {
    const scope = resolveExtensionCommandInvocationScope({
      entry: commandEntry({ declaredScopes: ['app', 'project'] }),
      projectPath: '/tmp/project',
    })

    expect(scope).toEqual({ kind: 'project', projectPath: '/tmp/project' })
  })

  it('prefers session scope for session-capable commands on a session route', () => {
    const scope = resolveExtensionCommandInvocationScope({
      entry: commandEntry({ declaredScopes: ['app', 'project', 'session'] }),
      projectPath: '/tmp/project',
      sessionId: 'session-1',
    })

    expect(scope).toEqual({
      kind: 'session',
      projectPath: '/tmp/project',
      sessionId: 'session-1',
    })
  })

  it('does not expose session-only commands outside a session route', () => {
    const scope = resolveExtensionCommandInvocationScope({
      entry: commandEntry({ declaredScopes: ['session'] }),
      projectPath: '/tmp/project',
    })

    expect(scope).toBeNull()
  })
})

describe('createExtensionCommandItems', () => {
  it('maps executable command contributions to command palette items', () => {
    const invokeCommand: InvokeExtensionCommand = vi.fn()
    const entry = commandEntry()
    const items = createExtensionCommandItems({
      registry: { projectPaths: ['/tmp/project'], entries: [entry] },
      lowerQuery: '',
      invokeCommand,
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'extension-command:sample.extension:sample.run',
      label: 'Run sample command',
      section: 'Sample',
      trailing: 'Sample Extension',
      trailingBadge: 'Global',
    })

    items[0]?.action()

    expect(invokeCommand).toHaveBeenCalledWith({ entry } satisfies ExtensionCommandActionInput)
  })

  it('omits non-command entries and commands without invocation targets', () => {
    const invokeCommand: InvokeExtensionCommand = vi.fn()
    const items = createExtensionCommandItems({
      registry: {
        projectPaths: ['/tmp/project'],
        entries: [
          commandEntry({ capability: undefined }),
          commandEntry({ method: undefined }),
          commandEntry({
            eligibility: {
              runtimeEnabled: false,
              enabled: false,
              trusted: true,
              sdkCompatible: true,
              updateAvailable: false,
              disabledProjectPaths: [],
            },
          }),
          commandEntry({
            family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SETTINGS_SECTIONS,
            entryPath: 'dist/settings.js',
          }),
        ],
      },
      lowerQuery: '',
      invokeCommand,
    })

    expect(items).toEqual([])
  })

  it('matches commands by extension metadata', () => {
    const invokeCommand: InvokeExtensionCommand = vi.fn()
    const items = createExtensionCommandItems({
      registry: {
        projectPaths: ['/tmp/project'],
        entries: [commandEntry()],
      },
      lowerQuery: 'sample',
      invokeCommand,
    })

    expect(items.map((item) => item.label)).toEqual(['Run sample command'])
  })
})

describe('createExtensionSidePanelItems', () => {
  it('maps openable side panel contributions to command palette items', () => {
    const openSidePanel: OpenExtensionSidePanel = vi.fn()
    const entry = commandEntry({
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
      contributionId: 'sample.panel',
      title: 'Open sample panel',
      runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
      execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
      entryPath: 'modules/side-panel.js',
    })
    const items = createExtensionSidePanelItems({
      registry: { projectPaths: ['/tmp/project'], entries: [entry] },
      lowerQuery: '',
      openSidePanel,
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'extension-side-panel:/tmp/sample-extension:abcdef:sample.panel',
      label: 'Open sample panel',
      section: 'Sample',
      trailing: 'Sample Extension',
      trailingBadge: 'Global',
    })

    items[0]?.action()

    expect(openSidePanel).toHaveBeenCalledWith({
      entry,
    } satisfies ExtensionSidePanelActionInput)
  })

  it('omits ineligible side panels and entries without renderer metadata', () => {
    const openSidePanel: OpenExtensionSidePanel = vi.fn()
    const items = createExtensionSidePanelItems({
      registry: {
        projectPaths: ['/tmp/project'],
        entries: [
          commandEntry({
            family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
            runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
            execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
          }),
          commandEntry({
            family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
            runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
            execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
            entryPath: 'modules/side-panel.js',
            eligibility: {
              runtimeEnabled: true,
              enabled: true,
              trusted: false,
              sdkCompatible: true,
              updateAvailable: false,
              disabledProjectPaths: [],
            },
          }),
          commandEntry({
            family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SETTINGS_SECTIONS,
            runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
            execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
            entryPath: 'modules/settings.js',
          }),
        ],
      },
      lowerQuery: '',
      openSidePanel,
    })

    expect(items).toEqual([])
  })
})

describe('createExtensionSlashCommandItems', () => {
  it('maps executable slash command contributions to insertable command palette items', () => {
    const insertCommand: InsertExtensionSlashCommand = vi.fn()
    const entry = commandEntry({
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SLASH_COMMANDS,
    })
    const items = createExtensionSlashCommandItems({
      registry: { projectPaths: ['/tmp/project'], entries: [entry] },
      lowerQuery: '',
      insertCommand,
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'extension-slash-command:sample.extension:sample.run',
      label: 'Run sample command',
      section: 'Sample',
      trailing: '/sample.run',
      trailingBadge: 'Global',
    })

    items[0]?.action()

    expect(insertCommand).toHaveBeenCalledWith({
      entry,
    } satisfies ExtensionSlashCommandActionInput)
  })

  it('omits non-slash entries, ineligible entries, and built-in command collisions', () => {
    const insertCommand: InsertExtensionSlashCommand = vi.fn()
    const items = createExtensionSlashCommandItems({
      registry: {
        projectPaths: ['/tmp/project'],
        entries: [
          commandEntry(),
          commandEntry({
            family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SLASH_COMMANDS,
            capability: undefined,
          }),
          commandEntry({
            family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SLASH_COMMANDS,
            contributionId: 'compact',
          }),
          commandEntry({
            family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SLASH_COMMANDS,
            eligibility: {
              runtimeEnabled: true,
              enabled: true,
              trusted: false,
              sdkCompatible: true,
              updateAvailable: false,
              disabledProjectPaths: [],
            },
          }),
        ],
      },
      lowerQuery: '',
      insertCommand,
    })

    expect(items).toEqual([])
  })

  it('matches slash commands by extension metadata', () => {
    const insertCommand: InsertExtensionSlashCommand = vi.fn()
    const items = createExtensionSlashCommandItems({
      registry: {
        projectPaths: ['/tmp/project'],
        entries: [
          commandEntry({
            family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SLASH_COMMANDS,
          }),
        ],
      },
      lowerQuery: 'sample',
      insertCommand,
    })

    expect(items.map((item) => item.label)).toEqual(['Run sample command'])
  })
})
