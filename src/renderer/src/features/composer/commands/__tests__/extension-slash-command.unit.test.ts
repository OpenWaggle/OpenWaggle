import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { describe, expect, it } from 'vitest'
import {
  extensionSlashCommandPayload,
  extensionSlashCommandText,
  invokableExtensionSlashCommandEntries,
  parseExtensionSlashCommand,
} from '../extension-slash-command'

function slashEntry(
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
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SLASH_COMMANDS,
    contributionId: 'sample.run',
    title: 'Run sample slash command',
    label: 'Run sample slash command',
    category: 'Sample',
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
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

function registry(
  entries: readonly ExtensionContributionRegistryEntry[],
): ExtensionContributionRegistryView {
  return {
    projectPaths: ['/tmp/project'],
    entries,
  }
}

describe('extension slash command parsing', () => {
  it('lists only eligible slash command contributions with broker invocation targets', () => {
    const disabledEntry = slashEntry({
      contributionId: 'sample.disabled',
      eligibility: {
        runtimeEnabled: false,
        enabled: false,
        trusted: true,
        sdkCompatible: true,
        updateAvailable: false,
        disabledProjectPaths: [],
      },
    })

    expect(
      invokableExtensionSlashCommandEntries(
        registry([
          slashEntry(),
          slashEntry({ family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS }),
          slashEntry({ contributionId: 'sample.missing-method', method: undefined }),
          slashEntry({ contributionId: 'compact', title: 'Conflicting compact command' }),
          disabledEntry,
        ]),
      ).map((entry) => entry.contributionId),
    ).toEqual(['sample.run'])
  })

  it('parses a submitted extension slash command and preserves trailing args', () => {
    const command = parseExtensionSlashCommand(
      '  /sample.run use current diff  ',
      registry([slashEntry()]),
    )

    expect(command).toMatchObject({
      command: '/sample.run',
      args: 'use current diff',
      rawText: '/sample.run use current diff',
      entry: { contributionId: 'sample.run' },
    })
    expect(command ? extensionSlashCommandPayload(command) : null).toEqual({
      command: '/sample.run',
      args: 'use current diff',
      rawText: '/sample.run use current diff',
    })
  })

  it('rejects lookalike commands and formats command text from contribution ids', () => {
    const entry = slashEntry()

    expect(extensionSlashCommandText(entry)).toBe('/sample.run')
    expect(parseExtensionSlashCommand('/sample.runner', registry([entry]))).toBeNull()
    expect(parseExtensionSlashCommand('please /sample.run', registry([entry]))).toBeNull()
    expect(parseExtensionSlashCommand('/sample.run', null)).toBeNull()
  })
})
