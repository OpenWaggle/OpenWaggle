import { describe, expect, it } from 'vitest'
import { OPENWAGGLE_EXTENSION } from '../constants'
import {
  extensionContributionRegistrationSchema,
  extensionRouteContributionSchema,
  extensionSidePanelIconSchema,
  extensionSlotContributionRegistrationSchema,
  validateExtensionManifest,
} from '../manifest'
import { safeDecodeExtensionSchema } from '../schema'

const sidePanel = {
  id: 'issues.panel',
  title: 'Issues',
  runtime: 'federated-module',
  execution: 'host-renderer',
  entry: 'dist/panel.js',
} as const

function manifestWithSidePanel(panel: Record<string, unknown>) {
  return {
    manifestVersion: 1,
    id: 'issues',
    name: 'Issues',
    version: '0.1.0',
    sdk: { openwaggle: '0.1.0' },
    sourceFiles: [],
    builtArtifacts: ['dist/panel.js'],
    contributions: { sidePanels: [panel] },
  }
}

describe('side panel icon manifest schema', () => {
  it('accepts a bundled Lucide icon name', () => {
    const result = validateExtensionManifest(
      manifestWithSidePanel({ ...sidePanel, icon: 'ticket' }),
    )

    expect(result.success).toBe(true)
    expect(result.success && result.manifest.contributions?.sidePanels?.[0]?.icon).toBe('ticket')
  })

  it('accepts multi-word kebab-case Lucide names', () => {
    expect(safeDecodeExtensionSchema(extensionSidePanelIconSchema, 'git-pull-request')).toEqual({
      success: true,
      data: 'git-pull-request',
    })
  })

  it('accepts a package-relative svg file', () => {
    const result = validateExtensionManifest(
      manifestWithSidePanel({ ...sidePanel, icon: { svg: 'assets/panel-icon.svg' } }),
    )

    expect(result.success).toBe(true)
    expect(result.success && result.manifest.contributions?.sidePanels?.[0]?.icon).toEqual({
      svg: 'assets/panel-icon.svg',
    })
  })

  it('keeps side panels without an icon valid', () => {
    expect(validateExtensionManifest(manifestWithSidePanel(sidePanel)).success).toBe(true)
  })

  it.each([
    ['parent traversal', { svg: '../outside.svg' }],
    ['nested traversal', { svg: 'assets/../../outside.svg' }],
    ['absolute path', { svg: '/etc/icon.svg' }],
    ['windows absolute path', { svg: 'C:\\icons\\icon.svg' }],
  ])('rejects %s in svg icon paths', (_label, icon) => {
    const result = validateExtensionManifest(manifestWithSidePanel({ ...sidePanel, icon }))

    expect(result.success).toBe(false)
  })

  it('rejects svg icon paths without an .svg extension', () => {
    const result = validateExtensionManifest(
      manifestWithSidePanel({ ...sidePanel, icon: { svg: 'assets/icon.png' } }),
    )

    expect(result.success).toBe(false)
    expect(result.success ? [] : result.issues.join('\n')).toContain('.svg')
  })

  it('rejects unknown keys in the svg icon object', () => {
    const result = validateExtensionManifest(
      manifestWithSidePanel({ ...sidePanel, icon: { svg: 'assets/icon.svg', color: 'red' } }),
    )

    expect(result.success).toBe(false)
  })

  it.each(['Ticket', 'git_pull_request', 'ticket-', 'ticket icon', ''])(
    'rejects non-kebab-case Lucide name %j',
    (icon) => {
      expect(safeDecodeExtensionSchema(extensionSidePanelIconSchema, icon).success).toBe(false)
    },
  )

  it('does not add an icon to routes', () => {
    const result = safeDecodeExtensionSchema(extensionRouteContributionSchema, {
      ...sidePanel,
      icon: 'ticket',
    })

    expect(result).toEqual({ success: true, data: sidePanel })
  })

  it('keeps the icon on runtime side panel registrations', () => {
    const result = safeDecodeExtensionSchema(extensionContributionRegistrationSchema, {
      family: 'sidePanels',
      contribution: { ...sidePanel, icon: { svg: 'assets/icon.svg' } },
    })

    expect(result).toEqual({
      success: true,
      data: {
        family: 'sidePanels',
        contribution: { ...sidePanel, icon: { svg: 'assets/icon.svg' } },
      },
    })
  })

  it.each([
    ['an invalid Lucide name', 'Not An Icon'],
    ['a path outside the package', { svg: '../outside.svg' }],
    ['a non-svg file', { svg: 'assets/icon.png' }],
  ])('rejects a runtime side panel registration whose icon is %s', (_label, icon) => {
    const result = safeDecodeExtensionSchema(extensionContributionRegistrationSchema, {
      family: 'sidePanels',
      contribution: { ...sidePanel, icon },
    })

    expect(result.success).toBe(false)
  })

  it('still accepts slot registrations for the other slot families', () => {
    const result = safeDecodeExtensionSchema(extensionContributionRegistrationSchema, {
      family: 'dialogs',
      contribution: sidePanel,
    })

    expect(result).toEqual({ success: true, data: { family: 'dialogs', contribution: sidePanel } })
  })

  it('registers every slot family except side panels through the slot schema', () => {
    const slotFamilies = OPENWAGGLE_EXTENSION.SLOT_CONTRIBUTION_FAMILIES.filter(
      (family) =>
        safeDecodeExtensionSchema(extensionSlotContributionRegistrationSchema, {
          family,
          contribution: sidePanel,
        }).success,
    )

    expect(slotFamilies).toEqual(
      OPENWAGGLE_EXTENSION.SLOT_CONTRIBUTION_FAMILIES.filter(
        (family) => family !== OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
      ),
    )
  })
})
