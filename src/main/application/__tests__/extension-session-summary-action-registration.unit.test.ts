import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { OpenWaggleExtensionManifest } from '@shared/schemas/extensions'
import { describe, expect, it } from 'vitest'
import {
  loadRegistry,
  makeLifecycle,
  makePackage,
  OTHER_PROJECT_PATH,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

type Contributions = NonNullable<OpenWaggleExtensionManifest['contributions']>
type SummaryAction = NonNullable<
  NonNullable<Contributions['sessionSummarySections']>[number]['rows'][number]['action']
>

function summaryContributions(action: SummaryAction): Contributions {
  return {
    sessionSummarySections: [
      {
        id: 'summary.section',
        title: 'Summary section',
        rows: [{ id: 'summary.action', label: 'Run action', action }],
      },
    ],
  }
}

function commandContribution(
  contributionId: string,
): NonNullable<Contributions['commands']>[number] {
  return { id: contributionId, title: 'Run command' }
}

describe('Session Summary action registration', () => {
  it('keeps actions that target an available contribution from the same package and family', async () => {
    const extensionPackage = makePackage({
      id: 'valid-summary-actions',
      name: 'Valid Summary Actions',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      capabilities: [
        {
          id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
          methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE],
          scopes: ['session'],
        },
      ],
      contributions: {
        commands: [
          {
            ...commandContribution('summary.run'),
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
          },
        ],
        ...summaryContributions({ family: 'commands', contributionId: 'summary.run' }),
      },
    })

    const registry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      projectPaths: [PROJECT_PATH],
    })

    expect(registry.entries.map(({ contributionId }) => contributionId)).toEqual([
      'summary.run',
      'summary.section',
    ])
    expect(registry.diagnostics).toEqual([])
  })

  it('withholds a Summary section whose action target is missing from its package', async () => {
    const extensionPackage = makePackage({
      id: 'missing-summary-action',
      name: 'Missing Summary Action',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: summaryContributions({
        family: 'commands',
        contributionId: 'missing.command',
      }),
    })

    const registry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      projectPaths: [PROJECT_PATH],
    })

    expect(registry.entries).toEqual([])
    expect(registry.diagnostics).toContainEqual(
      expect.objectContaining({
        code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.CONTRIBUTION_REGISTRATION_FAILED,
        message: expect.stringContaining('same package'),
      }),
    )
  })

  it('withholds a Summary section whose action names the wrong contribution family', async () => {
    const extensionPackage = makePackage({
      id: 'wrong-family-summary-action',
      name: 'Wrong Family Summary Action',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        sidePanels: [
          {
            id: 'summary.details',
            title: 'Summary details',
            runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
            execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
            entry: 'dist/details.js',
          },
        ],
        ...summaryContributions({ family: 'dialogs', contributionId: 'summary.details' }),
      },
    })

    const registry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      projectPaths: [PROJECT_PATH],
    })

    expect(registry.entries.map(({ contributionId }) => contributionId)).toEqual([
      'summary.details',
    ])
    expect(registry.diagnostics).toContainEqual(
      expect.objectContaining({
        code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.CONTRIBUTION_REGISTRATION_FAILED,
        message: expect.stringContaining('sidePanels'),
      }),
    )
  })

  it('withholds a Summary section whose declared action target failed registration', async () => {
    const extensionPackage = makePackage({
      id: 'unavailable-summary-action',
      name: 'Unavailable Summary Action',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [
          {
            ...commandContribution('summary.run'),
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
          },
        ],
        ...summaryContributions({ family: 'commands', contributionId: 'summary.run' }),
      },
    })

    const registry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      projectPaths: [PROJECT_PATH],
    })

    expect(registry.entries).toEqual([])
    expect(registry.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('does not declare') }),
        expect.objectContaining({ message: expect.stringContaining('unavailable') }),
      ]),
    )
  })

  it('withholds a Summary section whose command target has no executable binding', async () => {
    const extensionPackage = makePackage({
      id: 'disabled-summary-action',
      name: 'Disabled Summary Action',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [commandContribution('summary.run')],
        ...summaryContributions({ family: 'commands', contributionId: 'summary.run' }),
      },
    })

    const registry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      projectPaths: [PROJECT_PATH],
    })

    expect(registry.entries.map(({ contributionId }) => contributionId)).toEqual(['summary.run'])
    expect(registry.diagnostics).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('disabled') }),
    )
  })

  it('does not resolve a Summary action against another extension package', async () => {
    const summaryPackage = makePackage({
      id: 'summary-owner',
      name: 'Summary Owner',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: summaryContributions({
        family: 'commands',
        contributionId: 'shared.command',
      }),
    })
    const commandPackage = makePackage({
      id: 'command-owner',
      name: 'Command Owner',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: { commands: [commandContribution('shared.command')] },
    })

    const registry = await loadRegistry({
      packages: [summaryPackage, commandPackage],
      lifecycles: [makeLifecycle(summaryPackage), makeLifecycle(commandPackage)],
      projectPaths: [PROJECT_PATH],
    })

    expect(
      registry.entries.map(({ extensionId, contributionId }) => ({
        extensionId,
        contributionId,
      })),
    ).toEqual([{ extensionId: 'command-owner', contributionId: 'shared.command' }])
    expect(registry.diagnostics).toContainEqual(
      expect.objectContaining({
        path: expect.stringContaining('summary-owner'),
        message: expect.stringContaining('same package'),
      }),
    )
  })

  it('withholds a Summary section whose target is not available in the requested project', async () => {
    const extensionPackage = makePackage({
      id: 'scoped-summary-action',
      name: 'Scoped Summary Action',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [
          {
            ...commandContribution('summary.run'),
            target: { projectPaths: [OTHER_PROJECT_PATH] },
          },
        ],
        ...summaryContributions({ family: 'commands', contributionId: 'summary.run' }),
      },
    })

    const registry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      projectPaths: [PROJECT_PATH],
    })

    expect(registry.entries).toEqual([])
    expect(registry.diagnostics).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('unavailable') }),
    )
  })
})
