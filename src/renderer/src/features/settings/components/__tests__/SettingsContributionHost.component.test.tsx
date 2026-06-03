import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SettingsContributionHost,
  SettingsContributionSlot,
  SettingsContributionSlotBoundary,
} from '../sections/SettingsContributionHost'

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
}))

vi.mock('@/shared/lib/logger', () => ({
  createRendererLogger: () => loggerMock,
}))

const BASE_ENTRY: ExtensionContributionRegistryEntry = {
  extensionId: 'sample-extension',
  extensionName: 'Sample Extension',
  extensionVersion: '1.0.0',
  scope: {
    kind: 'project',
    label: 'Project',
    projectPath: '/tmp/project',
  },
  packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
  manifestPath: '/tmp/project/.openwaggle/extensions/sample-extension/openwaggle.extension.json',
  projectPaths: ['/tmp/project'],
  appliesToAllRequestedProjects: true,
  family: 'settingsSections',
  contributionId: 'sample.settings',
  title: 'Sample settings',
  label: 'Sample settings',
  lane: 'declarative',
  entryPath: 'dist/settings.js',
  capability: 'sample.configure',
  eligibility: {
    runtimeEnabled: true,
    enabled: true,
    trusted: true,
    sdkCompatible: true,
    updateAvailable: false,
    disabledProjectPaths: [],
  },
  diagnostics: [],
}

const COMMAND_ENTRY: ExtensionContributionRegistryEntry = {
  ...BASE_ENTRY,
  family: 'commands',
  contributionId: 'sample.run',
  title: 'Run sample',
  label: 'Run sample',
}

const WEBVIEW_ENTRY: ExtensionContributionRegistryEntry = {
  ...BASE_ENTRY,
  contributionId: 'sample.webview-settings',
  title: 'Webview settings',
  label: 'Webview settings',
  lane: 'webview',
  entryPath: 'dist/webview-settings.js',
}

const BLOCKED_ENTRY: ExtensionContributionRegistryEntry = {
  ...BASE_ENTRY,
  contributionId: 'sample.blocked-settings',
  title: 'Blocked settings',
  label: 'Blocked settings',
  appliesToAllRequestedProjects: false,
  eligibility: {
    runtimeEnabled: true,
    enabled: true,
    trusted: false,
    sdkCompatible: false,
    updateAvailable: true,
    disabledProjectPaths: ['/tmp/project'],
  },
  diagnostics: [
    {
      severity: 'error',
      code: 'runtime-load-failed',
      message: 'Extension settings renderer failed.',
    },
  ],
}

function registryWith(
  entries: readonly ExtensionContributionRegistryEntry[],
): ExtensionContributionRegistryView {
  return {
    projectPaths: ['/tmp/project'],
    entries,
  }
}

function ThrowingContribution(): never {
  throw new Error('Slot exploded')
}

describe('SettingsContributionHost', () => {
  afterEach(() => {
    loggerMock.error.mockClear()
  })

  it('renders declarative settings section contributions through native host cards', () => {
    render(<SettingsContributionHost registry={registryWith([COMMAND_ENTRY, BASE_ENTRY])} />)

    const host = screen.getByLabelText('Extension settings contributions')
    expect(within(host).getByText('Extension settings')).toBeInTheDocument()
    expect(within(host).getByText('Sample settings')).toBeInTheDocument()
    expect(within(host).getByText('Declarative')).toBeInTheDocument()
    expect(within(host).getByText('Native settings host')).toBeInTheDocument()
    expect(within(host).getByText('dist/settings.js')).toBeInTheDocument()
    expect(within(host).getByText('sample.configure')).toBeInTheDocument()
    expect(within(host).queryByText('Run sample')).not.toBeInTheDocument()
  })

  it('returns no host when the registry has no settings section contributions', () => {
    render(<SettingsContributionHost registry={registryWith([COMMAND_ENTRY])} />)

    expect(screen.queryByLabelText('Extension settings contributions')).not.toBeInTheDocument()
  })

  it('contains non-declarative lanes without attempting to mount them', () => {
    render(<SettingsContributionHost registry={registryWith([WEBVIEW_ENTRY])} />)

    const host = screen.getByLabelText('Extension settings contributions')
    expect(within(host).getByText('Webview settings')).toBeInTheDocument()
    expect(within(host).getByText('Webview')).toBeInTheDocument()
    expect(within(host).getByText('Renderer lane not mounted here.')).toBeInTheDocument()
  })

  it('surfaces contribution eligibility and diagnostics in the settings slot', () => {
    render(<SettingsContributionHost registry={registryWith([BLOCKED_ENTRY])} />)

    const host = screen.getByLabelText('Extension settings contributions')
    expect(within(host).getByText('Untrusted')).toBeInTheDocument()
    expect(within(host).getByText('SDK blocked')).toBeInTheDocument()
    expect(within(host).getByText('Update pending')).toBeInTheDocument()
    expect(within(host).getByText('1 project opt-out')).toBeInTheDocument()
    expect(within(host).getByText('runtime-load-failed')).toBeInTheDocument()
    expect(within(host).getByText(': Extension settings renderer failed.')).toBeInTheDocument()
  })

  it('contains a settings slot failure without hiding sibling settings contributions', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <div>
        <SettingsContributionSlotBoundary entry={BLOCKED_ENTRY}>
          <ThrowingContribution />
        </SettingsContributionSlotBoundary>
        <SettingsContributionSlotBoundary entry={BASE_ENTRY}>
          <SettingsContributionSlot entry={BASE_ENTRY} />
        </SettingsContributionSlotBoundary>
      </div>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Extension settings: Blocked settings panel error',
    )
    expect(screen.getByText('Slot exploded')).toBeInTheDocument()
    expect(screen.getByText('Sample settings')).toBeInTheDocument()
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Panel "Extension settings: Blocked settings" error',
      expect.objectContaining({ message: 'Slot exploded' }),
    )

    consoleError.mockRestore()
  })
})
