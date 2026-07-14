import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import {
  createNoopExtensionSurfaceSdk,
  createOpenWaggleExtensionSharedModules,
  createOpenWaggleExtensionSurfaceContext,
} from '@shared/extension-context'
import {
  createOpenWaggleExtensionTheme,
  extensionThemeCssVariableEntries,
} from '@shared/extension-theme'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { describe, expect, it } from 'vitest'

const ENTRY = {
  extensionId: 'sample-extension',
  extensionName: 'Sample Extension',
  extensionVersion: '1.0.0',
  scope: {
    kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
    label: 'Project',
    projectPath: '/tmp/project',
  },
  packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
  manifestPath: '/tmp/project/.openwaggle/extensions/sample-extension/openwaggle.extension.json',
  contentHash: 'abcdef',
  projectPaths: ['/tmp/project'],
  appliesToAllRequestedProjects: true,
  family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SETTINGS_SECTIONS,
  contributionId: 'sample.settings',
  title: 'Sample settings',
  label: 'Sample settings',
  runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
  execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.FRAME,
  entryPath: 'dist/settings.js',
  eligibility: {
    runtimeEnabled: true,
    enabled: true,
    trusted: true,
    sdkCompatible: true,
    updateAvailable: false,
    disabledProjectPaths: [],
  },
  diagnostics: [],
} satisfies ExtensionContributionRegistryEntry

describe('OpenWaggle extension context', () => {
  it('creates a framework-neutral mount context with stable theme token data', () => {
    const theme = createOpenWaggleExtensionTheme({
      resolveCssVariable: (cssVariable, fallback) =>
        cssVariable === '--color-accent' ? '#ffcc00' : fallback,
    })
    const context = createOpenWaggleExtensionSurfaceContext({
      entry: ENTRY,
      surfacePayload: { surface: 'settings' },
      theme,
    })

    expect(context).toMatchObject({
      extension: {
        id: 'sample-extension',
        name: 'Sample Extension',
        version: '1.0.0',
      },
      contribution: {
        id: 'sample.settings',
        title: 'Sample settings',
        family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SETTINGS_SECTIONS,
      },
      surface: {
        family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SETTINGS_SECTIONS,
        execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.FRAME,
        payload: { surface: 'settings' },
      },
      packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
      projectPaths: ['/tmp/project'],
      theme: {
        colorScheme: 'dark',
        tokens: {
          color: {
            accent: '#ffcc00',
            background: '#141619',
            text: '#e7e9ee',
          },
          radius: {
            panel: '22px',
          },
          spacing: {
            md: '12px',
          },
        },
        cssVariables: {
          color: {
            accent: '--ow-color-accent',
          },
          radius: {
            panel: '--ow-radius-panel',
          },
        },
      },
    })
  })

  it('exposes CSS variable entries and noop surface SDK affordances', async () => {
    const entries = extensionThemeCssVariableEntries(createOpenWaggleExtensionTheme())
    const surfaceSdk = createNoopExtensionSurfaceSdk()
    const modules = createOpenWaggleExtensionSharedModules()

    expect(entries).toContainEqual({ name: '--ow-color-accent', value: '#f5a623' })
    expect(entries).toContainEqual({ name: '--ow-radius-panel', value: '22px' })
    expect(modules.sdk.openWaggleVersion).toBe(OPENWAGGLE_EXTENSION.SDK_VERSION)
    expect(modules.theme.cssVariableEntries(modules.theme.current)).toContainEqual({
      name: '--ow-color-accent',
      value: '#f5a623',
    })
    expect(modules.ui.className(modules.ui.classNames.root, 'custom-panel')).toBe(
      'ow-extension-root custom-panel',
    )
    expect(modules.ui.createStylesheet()).toContain('.ow-extension-root .ow-extension-button')
    await expect(surfaceSdk.sendAction('refresh')).resolves.toBeUndefined()
    await expect(surfaceSdk.respondInteraction(null)).resolves.toBeUndefined()
  })
})
