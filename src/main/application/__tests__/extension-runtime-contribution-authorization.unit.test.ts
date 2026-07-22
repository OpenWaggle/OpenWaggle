import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { safeDecodeUnknown } from '@shared/schema'
import type { ExtensionContributionRegistration } from '@shared/schemas/extensions'
import { extensionContributionRegistrationSchema } from '@shared/schemas/extensions'
import { describe, expect, it } from 'vitest'
import { authorizeRuntimeContributionRegistration } from '../extension-runtime-contribution-authorization-model'
import { makePackage } from './extension-contribution-registry-test-utils'

function decodeRegistration(raw: unknown): ExtensionContributionRegistration {
  const decoded = safeDecodeUnknown(extensionContributionRegistrationSchema, raw)
  if (!decoded.success) {
    throw new Error(decoded.issues.join('\n'))
  }
  return decoded.data
}

describe('runtime extension contribution authorization', () => {
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

  it('authorizes trusted renderer runtime registration only when the package declares trusted renderer runtime', () => {
    const extensionPackage = makePackage({
      id: 'trusted-renderer-registration-extension',
      name: 'Trusted Renderer Registration Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      trusted: {
        renderer: 'dist/trusted-renderer.js',
      },
      contributions: {
        toolRenderers: [],
      },
    })
    const registration = decodeRegistration({
      family: 'toolRenderers',
      contribution: {
        id: 'runtime.trusted-tool',
        title: 'Runtime Trusted Tool',
        runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.TRUSTED_RENDERER,
        execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
        entry: 'dist/trusted-tool.js',
      },
    })

    expect(
      authorizeRuntimeContributionRegistration({
        extensionPackage,
        registration,
      }),
    ).toEqual({ _tag: 'authorized' })
  })

  it('rejects trusted renderer runtime registration when the package lacks trusted renderer runtime consent metadata', () => {
    const extensionPackage = makePackage({
      id: 'untrusted-renderer-registration-extension',
      name: 'Untrusted Renderer Registration Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        toolRenderers: [],
      },
    })
    const registration = decodeRegistration({
      family: 'toolRenderers',
      contribution: {
        id: 'runtime.trusted-tool',
        title: 'Runtime Trusted Tool',
        runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.TRUSTED_RENDERER,
        execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
        entry: 'dist/trusted-tool.js',
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
          message: expect.stringContaining(
            'Trusted renderer contributions require trusted.renderer',
          ),
        }),
      ],
    })
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

  it('rejects runtime registration that requests a capability outside the manifest', () => {
    const extensionPackage = makePackage({
      id: 'runtime-new-capability-extension',
      name: 'Runtime New Capability Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      capabilities: [
        {
          id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.GET],
          scopes: ['project'],
        },
      ],
      contributions: {
        settingsSections: [],
      },
    })
    const registration = decodeRegistration({
      family: 'settingsSections',
      contribution: {
        id: 'runtime.settings',
        title: 'Runtime Settings',
        runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
        execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
        entry: 'dist/settings.js',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
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
          message: expect.stringContaining('does not declare that capability'),
        }),
      ],
    })
  })

  it('rejects runtime registration that broadens manifest-declared capability methods', () => {
    const extensionPackage = makePackage({
      id: 'runtime-new-method-extension',
      name: 'Runtime New Method Extension',
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
        methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.GET, OPENWAGGLE_EXTENSION_BROKER.METHOD.SET],
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
          message: expect.stringContaining('does not declare that method'),
        }),
      ],
    })
  })

  it('rejects runtime registration that would replace a static manifest contribution', () => {
    const extensionPackage = makePackage({
      id: 'runtime-static-shadow-extension',
      name: 'Runtime Static Shadow Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        toolRenderers: [
          {
            id: 'static.tool',
            title: 'Static Tool',
            runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
            execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
            entry: 'dist/static-tool.js',
          },
        ],
      },
    })
    const registration = decodeRegistration({
      family: 'toolRenderers',
      contribution: {
        id: 'static.tool',
        title: 'Runtime Tool',
        runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
        execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
        entry: 'dist/runtime-tool.js',
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
          message: expect.stringContaining('cannot replace'),
        }),
      ],
    })
  })
})
