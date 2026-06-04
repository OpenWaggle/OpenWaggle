import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { describe, expect, it } from 'vitest'
import {
  expectFirstEntry,
  loadRegistry,
  makeLifecycle,
  makePackage,
  makeProjectOverride,
  OTHER_PROJECT_PATH,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

describe('listExtensionContributionRegistryView', () => {
  it('excludes disabled and untrusted packages', async () => {
    const disabledPackage = makePackage({
      id: 'disabled-extension',
      name: 'Disabled Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [{ id: 'disabled.run', title: 'Run Disabled' }],
      },
    })
    const untrustedPackage = makePackage({
      id: 'untrusted-extension',
      name: 'Untrusted Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [{ id: 'untrusted.run', title: 'Run Untrusted' }],
      },
    })

    const registry = await loadRegistry({
      packages: [disabledPackage, untrustedPackage],
      lifecycles: [
        makeLifecycle(disabledPackage, { enabled: false }),
        makeLifecycle(untrustedPackage, { trusted: false }),
      ],
      projectPaths: [PROJECT_PATH],
    })

    expect(registry.entries).toEqual([])
  })

  it('excludes project opt-outs only for the disabled project', async () => {
    const globalPackage = makePackage({
      id: 'global-extension',
      name: 'Global Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [{ id: 'global.run', title: 'Run Global' }],
      },
    })

    const registry = await loadRegistry({
      packages: [globalPackage],
      lifecycles: [makeLifecycle(globalPackage)],
      projectOverrides: [
        makeProjectOverride({
          extensionPackage: globalPackage,
          projectPath: PROJECT_PATH,
          disabled: true,
        }),
      ],
      projectPaths: [PROJECT_PATH, OTHER_PROJECT_PATH],
    })

    const entry = expectFirstEntry(registry)
    expect(registry.entries).toHaveLength(1)
    expect(entry.projectPaths).toEqual([OTHER_PROJECT_PATH])
    expect(entry.appliesToAllRequestedProjects).toBe(false)
    expect(entry.eligibility.disabledProjectPaths).toEqual([PROJECT_PATH])
  })

  it('applies global contributions to all requested projects', async () => {
    const globalPackage = makePackage({
      id: 'global-extension',
      name: 'Global Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [{ id: 'global.run', title: 'Run Global' }],
      },
    })

    const registry = await loadRegistry({
      packages: [globalPackage],
      lifecycles: [makeLifecycle(globalPackage)],
      projectPaths: [PROJECT_PATH, OTHER_PROJECT_PATH],
    })

    const entry = expectFirstEntry(registry)
    expect(entry.extensionId).toBe('global-extension')
    expect(entry.scope.kind).toBe(OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND)
    expect(entry.packagePath).toBe(globalPackage.packagePath)
    expect(entry.projectPaths).toEqual([PROJECT_PATH, OTHER_PROJECT_PATH])
    expect(entry.appliesToAllRequestedProjects).toBe(true)
  })

  it('registers global contributions when no project paths are requested', async () => {
    const globalPackage = makePackage({
      id: 'global-extension',
      name: 'Global Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [{ id: 'global.run', title: 'Run Global' }],
      },
    })

    const registry = await loadRegistry({
      packages: [globalPackage],
      lifecycles: [makeLifecycle(globalPackage)],
      projectPaths: [],
    })

    const entry = expectFirstEntry(registry)
    expect(registry.projectPaths).toEqual([])
    expect(entry.projectPaths).toEqual([])
    expect(entry.appliesToAllRequestedProjects).toBe(true)
  })

  it('applies project-local contributions only to the matching requested project', async () => {
    const projectPackage = makePackage({
      id: 'project-extension',
      name: 'Project Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
      contributions: {
        commands: [{ id: 'project.run', title: 'Run Project' }],
      },
    })

    const registry = await loadRegistry({
      packages: [projectPackage],
      lifecycles: [makeLifecycle(projectPackage)],
      projectPaths: [PROJECT_PATH, OTHER_PROJECT_PATH],
    })

    const entry = expectFirstEntry(registry)
    expect(registry.entries).toHaveLength(1)
    expect(entry.extensionId).toBe('project-extension')
    expect(entry.scope).toEqual({
      kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
      label: 'Project',
      projectPath: PROJECT_PATH,
    })
    expect(entry.projectPaths).toEqual([PROJECT_PATH])
    expect(entry.appliesToAllRequestedProjects).toBe(false)
  })

  it('preserves contribution families and entry paths from the manifest', async () => {
    const allFamiliesPackage = makePackage({
      id: 'family-extension',
      name: 'Family Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
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
            lane: 'declarative',
            entry: 'dist/route.js',
            capability: 'family.storage',
            methods: ['get', 'set'],
          },
        ],
        settingsSections: [
          {
            id: 'family.settings',
            title: 'Settings Contribution',
            lane: 'trusted-react',
            entry: 'dist/settings.js',
          },
        ],
        sidePanels: [
          {
            id: 'family.side-panel',
            title: 'Side Panel Contribution',
            lane: 'webview',
            entry: 'dist/side-panel.js',
          },
        ],
        dialogs: [
          {
            id: 'family.dialog',
            title: 'Dialog Contribution',
            lane: 'trusted-react',
            entry: 'dist/dialog.js',
          },
        ],
        transcriptRenderers: [
          {
            id: 'family.transcript',
            title: 'Transcript Contribution',
            lane: 'declarative',
            entry: 'dist/transcript.js',
          },
        ],
        statusWidgets: [
          {
            id: 'family.status',
            title: 'Status Contribution',
            lane: 'declarative',
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
    if (!commandEntry || !routeEntry) {
      throw new Error('Expected command and route contributions in the registry.')
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
      lane: 'declarative',
      entryPath: 'dist/route.js',
      capability: 'family.storage',
      methods: ['get', 'set'],
    })
  })
})
