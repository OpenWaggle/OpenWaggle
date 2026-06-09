import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { safeDecodeUnknown } from '@shared/schema'
import type { ExtensionContributionRegistration } from '@shared/schemas/extensions'
import { extensionContributionRegistrationSchema } from '@shared/schemas/extensions'
import { describe, expect, it } from 'vitest'
import { authorizeRuntimeContributionRegistration } from '../extension-contribution-authorization-model'
import {
  loadRegistry,
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

function decodeRegistration(raw: unknown): ExtensionContributionRegistration {
  const decoded = safeDecodeUnknown(extensionContributionRegistrationSchema, raw)
  if (!decoded.success) {
    throw new Error(decoded.issues.join('\n'))
  }
  return decoded.data
}

describe('extension contribution registration guard', () => {
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

  it('authorizes runtime registration only under manifest-declared families', () => {
    const extensionPackage = makePackage({
      id: 'runtime-registration-extension',
      name: 'Runtime Registration Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      capabilities: [
        {
          id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.GET],
          scopes: ['project'],
        },
      ],
      contributions: {
        toolRenderers: [],
      },
    })
    const registration = decodeRegistration({
      family: 'toolRenderers',
      contribution: {
        id: 'runtime.tool',
        title: 'Runtime Tool',
        runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
        execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
        entry: 'dist/tool.js',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
      },
    })

    expect(
      authorizeRuntimeContributionRegistration({
        extensionPackage,
        registration,
      }),
    ).toEqual({ _tag: 'authorized' })
  })

  it('rejects runtime registration for missing manifest-declared families', () => {
    const extensionPackage = makePackage({
      id: 'missing-runtime-family-extension',
      name: 'Missing Runtime Family Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        settingsSections: [],
      },
    })
    const registration = decodeRegistration({
      family: 'toolRenderers',
      contribution: {
        id: 'runtime.tool',
        title: 'Runtime Tool',
        runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
        execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
        entry: 'dist/tool.js',
      },
    })

    const authorization = authorizeRuntimeContributionRegistration({
      extensionPackage,
      registration,
    })

    expect(authorization).toEqual({
      _tag: 'rejected',
      diagnostics: [
        expect.objectContaining({
          severity: OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY.ERROR,
          code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.CONTRIBUTION_REGISTRATION_FAILED,
          message: expect.stringContaining('not declared in the extension manifest'),
        }),
      ],
    })
  })
})
