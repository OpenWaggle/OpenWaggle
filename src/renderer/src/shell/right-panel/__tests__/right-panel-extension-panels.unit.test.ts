import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { describe, expect, it } from 'vitest'
import { extensionRightPanelSurfaceId } from '@/shared/lib/right-panel-surfaces'
import { railExtensionPanels } from '../right-panel-extension-panels'

const PROJECT = '/project'

function sidePanel(
  id: string,
  overrides: Partial<ExtensionContributionRegistryEntry> = {},
  eligibility: Partial<ExtensionContributionRegistryEntry['eligibility']> = {},
): ExtensionContributionRegistryEntry {
  return {
    extensionId: 'linear',
    extensionName: 'Linear Sync',
    extensionVersion: '1.0.0',
    scope: {
      kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
      label: 'Project',
      projectPath: PROJECT,
    },
    packagePath: `${PROJECT}/.openwaggle/extensions/linear`,
    manifestPath: `${PROJECT}/.openwaggle/extensions/linear/openwaggle.extension.json`,
    contentHash: 'hash-1',
    projectPaths: [PROJECT],
    appliesToAllRequestedProjects: true,
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
    contributionId: id,
    title: `Panel ${id}`,
    label: id,
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: 'dist/panel.js',
    eligibility: {
      runtimeEnabled: true,
      enabled: true,
      trusted: true,
      sdkCompatible: true,
      updateAvailable: false,
      disabledProjectPaths: [],
      ...eligibility,
    },
    diagnostics: [],
    ...overrides,
  }
}

function list(entries: readonly ExtensionContributionRegistryEntry[]) {
  return railExtensionPanels({ projectPaths: [PROJECT], entries }, [PROJECT])
}

describe('railExtensionPanels', () => {
  it('lists runnable side panels with a stable surface id and the declared icon', () => {
    const icon = { source: 'lucide' as const, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' }
    const [panel] = list([sidePanel('issues', { icon })])
    expect(panel).toMatchObject({
      id: extensionRightPanelSurfaceId({ extensionId: 'linear', sidePanelId: 'issues' }),
      title: 'Panel issues',
      extensionName: 'Linear Sync',
      icon,
      status: { kind: 'available' },
    })
  })

  it('labels panels that need trust or an update instead of hiding them', () => {
    const panels = list([
      sidePanel('a', {}, { trusted: false }),
      sidePanel('b', {}, { updateAvailable: true }),
      sidePanel('c', {}, { sdkCompatible: false }),
    ])
    expect(panels.map((panel) => panel.status.kind === 'needs' && panel.status.label)).toEqual([
      'Needs trust',
      'Needs update',
      'Needs update',
    ])
  })

  it('hides panels the user turned off or that do not apply here', () => {
    expect(
      list([
        sidePanel('off', {}, { enabled: false }),
        sidePanel('runtime', {}, { runtimeEnabled: false }),
        sidePanel('unloadable', {
          runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.TRUSTED_RENDERER,
        }),
        sidePanel('project', {}, { disabledProjectPaths: [PROJECT] }),
        sidePanel('elsewhere', { projectPaths: ['/other'] }),
        { ...sidePanel('route'), family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.ROUTES },
      ]),
    ).toEqual([])
  })

  it('keeps one entry per surface, preferring a runnable package scope', () => {
    const panels = list([
      sidePanel('issues', { contentHash: 'old' }, { trusted: false }),
      sidePanel('issues', { contentHash: 'new' }),
    ])
    expect(panels).toHaveLength(1)
    expect(panels[0]).toMatchObject({ contentHash: 'new', status: { kind: 'available' } })
  })
})
