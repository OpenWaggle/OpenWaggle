import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearExtensionContributionRegistryCacheForTests,
  getExtensionContributionRegistryCacheStatsForTests,
} from '../extension-contribution-registry-cache'
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
  beforeEach(() => {
    clearExtensionContributionRegistryCacheForTests()
  })

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

  it('exposes default app scope for broker-bound contributions', async () => {
    const extensionPackage = makePackage({
      id: 'scoped-extension',
      name: 'Scoped Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      capabilities: [{ id: 'scoped.execute', methods: ['run'] }],
      contributions: {
        commands: [
          {
            id: 'scoped.run',
            title: 'Run Scoped',
            capability: 'scoped.execute',
            method: 'run',
          },
        ],
      },
    })

    const registry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      projectPaths: [PROJECT_PATH],
    })

    expect(expectFirstEntry(registry).declaredScopes).toEqual(['app'])
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

  it('reuses cached contribution registration for unchanged package inputs', async () => {
    const extensionPackage = makePackage({
      id: 'cached-extension',
      name: 'Cached Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [{ id: 'cached.run', title: 'Run Cached' }],
      },
    })
    const lifecycle = makeLifecycle(extensionPackage)

    const firstRegistry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
      projectPaths: [PROJECT_PATH],
    })
    const firstEntry = expectFirstEntry(firstRegistry)
    expect(firstEntry.contributionId).toBe('cached.run')
    expect(getExtensionContributionRegistryCacheStatsForTests()).toEqual({
      hits: 0,
      misses: 1,
      invalidations: 0,
      size: 1,
    })

    const secondRegistry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
      projectPaths: [PROJECT_PATH],
    })

    expect(expectFirstEntry(secondRegistry).contributionId).toBe('cached.run')
    expect(getExtensionContributionRegistryCacheStatsForTests()).toEqual({
      hits: 1,
      misses: 1,
      invalidations: 0,
      size: 1,
    })
  })

  it('invalidates cached contribution registration when the discovered content hash changes', async () => {
    const originalPackage = {
      ...makePackage({
        id: 'changed-extension',
        name: 'Changed Extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
        contributions: {
          commands: [{ id: 'changed.before', title: 'Run Before' }],
        },
      }),
      contentHash: 'before-content-hash',
    }
    const changedPackage = {
      ...makePackage({
        id: 'changed-extension',
        name: 'Changed Extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
        contributions: {
          commands: [{ id: 'changed.after', title: 'Run After' }],
        },
      }),
      contentHash: 'after-content-hash',
    }

    const originalRegistry = await loadRegistry({
      packages: [originalPackage],
      lifecycles: [makeLifecycle(originalPackage)],
      projectPaths: [PROJECT_PATH],
    })
    expect(expectFirstEntry(originalRegistry).contributionId).toBe('changed.before')

    const changedRegistry = await loadRegistry({
      packages: [changedPackage],
      lifecycles: [makeLifecycle(changedPackage)],
      projectPaths: [PROJECT_PATH],
    })
    expect(expectFirstEntry(changedRegistry).contributionId).toBe('changed.after')
    expect(getExtensionContributionRegistryCacheStatsForTests()).toEqual({
      hits: 0,
      misses: 2,
      invalidations: 1,
      size: 1,
    })
  })

  it('keeps project override eligibility live when contribution registration is cached', async () => {
    const extensionPackage = makePackage({
      id: 'override-cache-extension',
      name: 'Override Cache Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [{ id: 'override-cache.run', title: 'Run With Override' }],
      },
    })
    const lifecycle = makeLifecycle(extensionPackage)

    const enabledRegistry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
      projectPaths: [PROJECT_PATH, OTHER_PROJECT_PATH],
    })
    expect(expectFirstEntry(enabledRegistry).projectPaths).toEqual([
      PROJECT_PATH,
      OTHER_PROJECT_PATH,
    ])

    const partiallyDisabledRegistry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
      projectOverrides: [
        makeProjectOverride({
          extensionPackage,
          projectPath: PROJECT_PATH,
          disabled: true,
        }),
      ],
      projectPaths: [PROJECT_PATH, OTHER_PROJECT_PATH],
    })

    expect(expectFirstEntry(partiallyDisabledRegistry).projectPaths).toEqual([OTHER_PROJECT_PATH])
    expect(getExtensionContributionRegistryCacheStatsForTests()).toEqual({
      hits: 1,
      misses: 1,
      invalidations: 0,
      size: 1,
    })
  })
})
