import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { safeDecodeUnknown } from '@shared/schema'
import type { ExtensionContributionUnregistration } from '@shared/schemas/extensions'
import { extensionContributionUnregistrationSchema } from '@shared/schemas/extensions'
import { describe, expect, it } from 'vitest'
import { authorizeRuntimeContributionUnregistration } from '../extension-runtime-contribution-authorization-model'
import { makePackage } from './extension-contribution-registry-test-utils'

function decodeUnregistration(raw: unknown): ExtensionContributionUnregistration {
  const decoded = safeDecodeUnknown(extensionContributionUnregistrationSchema, raw)
  if (!decoded.success) {
    throw new Error(decoded.issues.join('\n'))
  }
  return decoded.data
}

describe('runtime extension contribution unregistration authorization', () => {
  it('authorizes runtime unregistration under manifest-declared families', () => {
    const extensionPackage = makePackage({
      id: 'runtime-unregistration-extension',
      name: 'Runtime Unregistration Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        toolRenderers: [],
      },
    })
    const unregistration = decodeUnregistration({
      family: 'toolRenderers',
      contributionId: 'runtime.tool',
    })

    expect(
      authorizeRuntimeContributionUnregistration({
        extensionPackage,
        unregistration,
      }),
    ).toEqual({ _tag: 'authorized' })
  })

  it('rejects runtime unregistration for missing manifest-declared families', () => {
    const extensionPackage = makePackage({
      id: 'runtime-unregistration-missing-family-extension',
      name: 'Runtime Unregistration Missing Family Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        settingsSections: [],
      },
    })
    const unregistration = decodeUnregistration({
      family: 'toolRenderers',
      contributionId: 'runtime.tool',
    })

    const authorization = authorizeRuntimeContributionUnregistration({
      extensionPackage,
      unregistration,
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

  it('rejects runtime unregistration of static manifest contributions', () => {
    const extensionPackage = makePackage({
      id: 'runtime-unregistration-static-extension',
      name: 'Runtime Unregistration Static Extension',
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
    const unregistration = decodeUnregistration({
      family: 'toolRenderers',
      contributionId: 'static.tool',
    })

    const authorization = authorizeRuntimeContributionUnregistration({
      extensionPackage,
      unregistration,
    })

    expect(authorization).toEqual({
      _tag: 'rejected',
      diagnostics: [
        expect.objectContaining({
          severity: OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY.ERROR,
          code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.CONTRIBUTION_REGISTRATION_FAILED,
          message: expect.stringContaining('cannot remove'),
        }),
      ],
    })
  })
})
