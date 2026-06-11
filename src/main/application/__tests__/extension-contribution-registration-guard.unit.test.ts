import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { describe, expect, it } from 'vitest'
import {
  loadRegistry,
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

describe('extension contribution registration guard', () => {
  it('does not register contributions that request extension package mutation capabilities', async () => {
    const invalidPackage = makePackage({
      id: 'package-mutation-extension',
      name: 'Package Mutation Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      capabilities: [
        {
          id: 'openwaggle.extensions.packages',
          methods: ['write-package'],
          scopes: ['project'],
        },
      ],
      contributions: {
        commands: [
          {
            id: 'invalid.package-write',
            title: 'Invalid Package Write',
            capability: 'openwaggle.extensions.packages',
            method: 'write-package',
          },
        ],
      },
    })

    const registry = await loadRegistry({
      packages: [invalidPackage],
      lifecycles: [makeLifecycle(invalidPackage)],
      projectPaths: [PROJECT_PATH],
    })

    expect(registry.entries).toEqual([])
    expect(registry.diagnostics).toEqual([
      expect.objectContaining({
        severity: OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY.ERROR,
        code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.CONTRIBUTION_REGISTRATION_FAILED,
        message: expect.stringContaining('user-approved extension package workflow'),
      }),
    ])
  })

  it('does not register contributions that request undeclared manifest capabilities', async () => {
    const invalidPackage = makePackage({
      id: 'undeclared-capability-extension',
      name: 'Undeclared Capability Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [{ id: 'valid.run', title: 'Run Valid' }],
        settingsSections: [
          {
            id: 'invalid.settings',
            title: 'Invalid Settings',
            runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
            execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
            entry: 'dist/settings.js',
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
          },
        ],
      },
    })

    const registry = await loadRegistry({
      packages: [invalidPackage],
      lifecycles: [makeLifecycle(invalidPackage)],
      projectPaths: [PROJECT_PATH],
    })

    expect(registry.entries.map((entry) => entry.contributionId)).toEqual(['valid.run'])
    expect(registry.diagnostics).toEqual([
      expect.objectContaining({
        severity: OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY.ERROR,
        code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.CONTRIBUTION_REGISTRATION_FAILED,
        message: expect.stringContaining('does not declare that capability'),
      }),
    ])
  })

  it('does not register contributions that request undeclared manifest capability methods', async () => {
    const invalidPackage = makePackage({
      id: 'undeclared-method-extension',
      name: 'Undeclared Method Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      capabilities: [
        {
          id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.GET],
          scopes: ['project'],
        },
      ],
      contributions: {
        toolRenderers: [
          {
            id: 'invalid.tool',
            title: 'Invalid Tool',
            runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
            execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
            entry: 'dist/tool.js',
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
            methods: [
              OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
              OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
            ],
          },
        ],
      },
    })

    const registry = await loadRegistry({
      packages: [invalidPackage],
      lifecycles: [makeLifecycle(invalidPackage)],
      projectPaths: [PROJECT_PATH],
    })

    expect(registry.entries).toEqual([])
    expect(registry.diagnostics).toEqual([
      expect.objectContaining({
        severity: OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY.ERROR,
        code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.CONTRIBUTION_REGISTRATION_FAILED,
        message: expect.stringContaining('does not declare that method'),
      }),
    ])
  })
})
