import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { describe, expect, it } from 'vitest'
import {
  expectFirstEntry,
  loadRegistry,
  makeLifecycle,
  makePackage,
  OTHER_PROJECT_PATH,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

describe('listExtensionContributionRegistryView contribution targets', () => {
  it('filters contribution project targets inside enabled package scope', async () => {
    const globalPackage = makePackage({
      id: 'targeted-extension',
      name: 'Targeted Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [
          {
            id: 'targeted.run',
            title: 'Run Targeted',
            target: { projectPaths: [PROJECT_PATH] },
          },
        ],
      },
    })

    const registry = await loadRegistry({
      packages: [globalPackage],
      lifecycles: [makeLifecycle(globalPackage)],
      projectPaths: [PROJECT_PATH, OTHER_PROJECT_PATH],
    })

    const entry = expectFirstEntry(registry)
    expect(registry.entries).toHaveLength(1)
    expect(entry.projectPaths).toEqual([PROJECT_PATH])
    expect(entry.appliesToAllRequestedProjects).toBe(false)
    expect(entry.target).toEqual({ projectPaths: [PROJECT_PATH] })
  })

  it('excludes contribution project targets outside request scope', async () => {
    const globalPackage = makePackage({
      id: 'outside-target-extension',
      name: 'Outside Target Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [
          {
            id: 'outside.run',
            title: 'Run Outside',
            target: { projectPaths: [OTHER_PROJECT_PATH] },
          },
        ],
      },
    })

    const registry = await loadRegistry({
      packages: [globalPackage],
      lifecycles: [makeLifecycle(globalPackage)],
      projectPaths: [PROJECT_PATH],
    })

    expect(registry.entries).toEqual([])
  })

  it('filters session-targeted contributions by requested session context', async () => {
    const sessionPackage = makePackage({
      id: 'session-extension',
      name: 'Session Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [
          {
            id: 'session.run',
            title: 'Run Session',
            target: { sessionIds: ['session-1'] },
          },
        ],
      },
    })
    const lifecycle = makeLifecycle(sessionPackage)

    const withoutSession = await loadRegistry({
      packages: [sessionPackage],
      lifecycles: [lifecycle],
      projectPaths: [PROJECT_PATH],
    })
    const wrongSession = await loadRegistry({
      packages: [sessionPackage],
      lifecycles: [lifecycle],
      projectPaths: [PROJECT_PATH],
      sessionId: 'session-2',
    })
    const matchingSession = await loadRegistry({
      packages: [sessionPackage],
      lifecycles: [lifecycle],
      projectPaths: [PROJECT_PATH],
      sessionId: 'session-1',
    })

    expect(withoutSession.entries).toEqual([])
    expect(wrongSession.entries).toEqual([])
    expect(matchingSession.entries.map((entry) => entry.contributionId)).toEqual(['session.run'])
  })

  it('carries manifest network origins into contribution entries', async () => {
    const networkPackage = makePackage({
      id: 'network-extension',
      name: 'Network Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      network: {
        origins: ['https://api.github.com'],
      },
      contributions: {
        sidePanels: [
          {
            id: 'network.panel',
            title: 'Network Panel',
            runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
            execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.FRAME,
            entry: 'dist/panel.js',
          },
        ],
      },
    })

    const registry = await loadRegistry({
      packages: [networkPackage],
      lifecycles: [makeLifecycle(networkPackage)],
      projectPaths: [PROJECT_PATH],
    })

    expect(expectFirstEntry(registry).networkOrigins).toEqual(['https://api.github.com'])
  })
})
