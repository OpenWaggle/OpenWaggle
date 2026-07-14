import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { describe, expect, it } from 'vitest'
import {
  loadRegistry,
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

describe('listExtensionContributionRegistryView contribution families', () => {
  it('preserves contribution families and entry paths from the manifest', async () => {
    const allFamiliesPackage = makePackage({
      id: 'family-extension',
      name: 'Family Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      capabilities: [
        { id: 'family.invoke' },
        { id: 'family.storage', methods: ['get', 'set'], scopes: ['project'] },
      ],
      contributions: {
        commands: [
          {
            id: 'family.command',
            title: 'Command Contribution',
            category: 'Tools',
            capability: 'family.invoke',
          },
        ],
        slashCommands: [{ id: 'family/slash', title: 'Slash Contribution' }],
        routes: [
          {
            id: 'family.route',
            title: 'Route Contribution',
            runtime: 'federated-module',
            execution: 'host-renderer',
            entry: 'dist/route.js',
            capability: 'family.storage',
            methods: ['get', 'set'],
          },
        ],
        settingsSections: [
          {
            id: 'family.settings',
            title: 'Settings Contribution',
            runtime: 'federated-module',
            execution: 'host-renderer',
            entry: 'dist/settings.js',
          },
        ],
        sidePanels: [
          {
            id: 'family.side-panel',
            title: 'Side Panel Contribution',
            runtime: 'federated-module',
            execution: 'frame',
            entry: 'dist/side-panel.js',
          },
        ],
        dialogs: [
          {
            id: 'family.dialog',
            title: 'Dialog Contribution',
            runtime: 'federated-module',
            execution: 'host-renderer',
            entry: 'dist/dialog.js',
          },
        ],
        transcriptRenderers: [
          {
            id: 'family.transcript',
            title: 'Transcript Contribution',
            runtime: 'federated-module',
            execution: 'host-renderer',
            entry: 'dist/transcript.js',
          },
        ],
        toolRenderers: [
          {
            id: 'family.tool',
            title: 'Tool Contribution',
            runtime: 'federated-module',
            execution: 'host-renderer',
            entry: 'dist/tool.js',
            matches: {
              toolNames: ['sample.tool'],
            },
          },
        ],
        customMessageRenderers: [
          {
            id: 'family.custom-message',
            title: 'Custom Message Contribution',
            runtime: 'federated-module',
            execution: 'host-renderer',
            entry: 'dist/custom-message.js',
            matches: {
              customMessageNames: ['sample.message'],
            },
          },
        ],
        interactionRenderers: [
          {
            id: 'family.interaction',
            title: 'Interaction Contribution',
            runtime: 'federated-module',
            execution: 'host-renderer',
            entry: 'dist/interaction.js',
            matches: {
              interactionKinds: ['sample.interaction'],
            },
          },
        ],
        statusWidgets: [
          {
            id: 'family.status',
            title: 'Status Contribution',
            runtime: 'federated-module',
            execution: 'host-renderer',
            entry: 'dist/status.js',
          },
        ],
      },
    })

    const registry = await loadRegistry({
      packages: [allFamiliesPackage],
      lifecycles: [makeLifecycle(allFamiliesPackage)],
      projectPaths: [PROJECT_PATH],
    })

    expect(registry.entries.map((entry) => entry.family)).toEqual([
      ...OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILIES,
    ])

    const commandEntry = registry.entries.find((entry) => entry.family === 'commands')
    const routeEntry = registry.entries.find((entry) => entry.family === 'routes')
    const toolEntry = registry.entries.find((entry) => entry.family === 'toolRenderers')
    if (!commandEntry || !routeEntry || !toolEntry) {
      throw new Error('Expected command, route, and tool contributions in the registry.')
    }

    expect(commandEntry).toMatchObject({
      contributionId: 'family.command',
      title: 'Command Contribution',
      label: 'Command Contribution',
      category: 'Tools',
      capability: 'family.invoke',
    })
    expect('entryPath' in commandEntry).toBe(false)
    expect(routeEntry).toMatchObject({
      contributionId: 'family.route',
      title: 'Route Contribution',
      label: 'Route Contribution',
      runtime: 'federated-module',
      execution: 'host-renderer',
      entryPath: 'dist/route.js',
      capability: 'family.storage',
      methods: ['get', 'set'],
    })
    expect(toolEntry).toMatchObject({
      contributionId: 'family.tool',
      matches: {
        toolNames: ['sample.tool'],
      },
    })
  })
})
