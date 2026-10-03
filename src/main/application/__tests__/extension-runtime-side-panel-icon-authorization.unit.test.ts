import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { safeDecodeUnknown } from '@shared/schema'
import {
  type ExtensionContributionRegistration,
  extensionContributionRegistrationSchema,
} from '@shared/schemas/extensions'
import { describe, expect, it } from 'vitest'
import { authorizeRuntimeContributionRegistration } from '../extension-runtime-contribution-authorization-model'
import { makePackage } from './extension-contribution-registry-test-utils'

const SIDE_PANEL = {
  title: 'Board',
  runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
  execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
  entry: 'dist/board.js',
} as const

const extensionPackage = makePackage({
  id: 'runtime-icon-extension',
  name: 'Runtime Icon Extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
  contributions: {
    sidePanels: [{ ...SIDE_PANEL, id: 'static.board', icon: { svg: 'assets/board.svg' } }],
  },
})

function sidePanelRegistration(icon: unknown): ExtensionContributionRegistration {
  const decoded = safeDecodeUnknown(extensionContributionRegistrationSchema, {
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
    contribution: { ...SIDE_PANEL, id: 'runtime.board', icon },
  })
  if (!decoded.success) throw new Error(decoded.issues.join('\n'))
  return decoded.data
}

describe('runtime side panel icon authorization', () => {
  it.each([
    ['a Lucide icon name', 'ticket'],
    ['an SVG file the manifest declares', { svg: 'assets/board.svg' }],
    ['a declared SVG file with Windows separators', { svg: 'assets\\board.svg' }],
  ])('authorizes %s', (_label, icon) => {
    expect(
      authorizeRuntimeContributionRegistration({
        extensionPackage,
        registration: sidePanelRegistration(icon),
      }),
    ).toEqual({ _tag: 'authorized' })
  })

  it('rejects an SVG file named only at runtime, outside the content hash', () => {
    expect(
      authorizeRuntimeContributionRegistration({
        extensionPackage,
        registration: sidePanelRegistration({ svg: 'assets/runtime-only.svg' }),
      }),
    ).toEqual({
      _tag: 'rejected',
      diagnostics: [
        expect.objectContaining({
          code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.CONTRIBUTION_REGISTRATION_FAILED,
          message: expect.stringContaining('"assets/runtime-only.svg" is not declared'),
        }),
      ],
    })
  })

  it('rejects a runtime side panel registration whose icon is invalid', () => {
    const decoded = safeDecodeUnknown(extensionContributionRegistrationSchema, {
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
      contribution: { ...SIDE_PANEL, id: 'runtime.board', icon: { svg: '../outside.svg' } },
    })

    expect(decoded.success).toBe(false)
  })
})
