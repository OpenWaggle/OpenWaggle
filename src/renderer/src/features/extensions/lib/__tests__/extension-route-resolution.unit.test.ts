import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { describe, expect, it } from 'vitest'
import { resolveExtensionRouteContribution } from '../extension-route-resolution'

const PROJECT_PATH = '/tmp/project'
const OTHER_PROJECT_PATH = '/tmp/other-project'

function routeEntry(
  overrides: Partial<ExtensionContributionRegistryEntry> = {},
): ExtensionContributionRegistryEntry {
  return {
    extensionId: 'sample-extension',
    extensionName: 'Sample Extension',
    extensionVersion: '1.0.0',
    scope: {
      kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
      label: 'Project',
      projectPath: PROJECT_PATH,
    },
    packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
    manifestPath: '/tmp/project/.openwaggle/extensions/sample-extension/openwaggle.extension.json',
    projectPaths: [PROJECT_PATH],
    appliesToAllRequestedProjects: true,
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.ROUTES,
    contributionId: 'sample.route',
    title: 'Sample route',
    label: 'Sample route',
    lane: 'webview',
    entryPath: 'dist/route.html',
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
    projectPaths: [PROJECT_PATH],
    entries,
  }
}

describe('resolveExtensionRouteContribution', () => {
  it('resolves a registered route contribution for the requested project', () => {
    const entry = routeEntry({ contributionId: 'sample/nested-route' })

    const resolution = resolveExtensionRouteContribution({
      registry: registry([entry]),
      extensionId: 'sample-extension',
      routeId: 'sample/nested-route',
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'available',
      contribution: {
        entry,
        lane: 'webview',
        entryPath: 'dist/route.html',
      },
    })
  })

  it('returns contained not-found states for unknown extensions and routes', () => {
    const extensionResolution = resolveExtensionRouteContribution({
      registry: registry([routeEntry()]),
      extensionId: 'missing-extension',
      routeId: 'sample.route',
      requestedProjectPaths: [PROJECT_PATH],
    })
    const routeResolution = resolveExtensionRouteContribution({
      registry: registry([routeEntry()]),
      extensionId: 'sample-extension',
      routeId: 'missing.route',
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(extensionResolution).toMatchObject({
      status: 'not-found',
      title: 'Extension route not available',
    })
    expect(routeResolution).toMatchObject({
      status: 'not-found',
      title: 'Route contribution not available',
    })
  })

  it('blocks route entries that are not eligible for the active project', () => {
    const resolution = resolveExtensionRouteContribution({
      registry: registry([
        routeEntry({
          appliesToAllRequestedProjects: false,
          projectPaths: [OTHER_PROJECT_PATH],
          eligibility: {
            runtimeEnabled: true,
            enabled: true,
            trusted: true,
            sdkCompatible: true,
            updateAvailable: false,
            disabledProjectPaths: [PROJECT_PATH],
          },
        }),
      ]),
      extensionId: 'sample-extension',
      routeId: 'sample.route',
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'blocked',
      title: 'Extension route blocked',
    })
  })

  it('rejects route entries missing host metadata before mounting a sandbox', () => {
    const resolution = resolveExtensionRouteContribution({
      registry: registry([routeEntry({ entryPath: undefined })]),
      extensionId: 'sample-extension',
      routeId: 'sample.route',
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'invalid',
      title: 'Route contribution incomplete',
    })
  })
})
