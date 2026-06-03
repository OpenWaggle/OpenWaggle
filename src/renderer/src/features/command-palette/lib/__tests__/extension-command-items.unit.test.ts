import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { describe, expect, it, vi } from 'vitest'
import {
  createExtensionCommandItems,
  type ExtensionCommandActionInput,
  type InvokeExtensionCommand,
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
