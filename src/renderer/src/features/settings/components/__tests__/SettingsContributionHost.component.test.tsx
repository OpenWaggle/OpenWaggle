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
  contentHash: 'abcdef',
  projectPaths: ['/tmp/project'],
  appliesToAllRequestedProjects: true,
  family: 'settingsSections',
  contributionId: 'sample.settings',
  title: 'Sample settings',
  label: 'Sample settings',
  runtime: 'federated-module',
  execution: 'host-renderer',
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

const FRAME_ENTRY: ExtensionContributionRegistryEntry = {
  ...BASE_ENTRY,
  contributionId: 'sample.frame-settings',
  title: 'Frame settings',
  label: 'Frame settings',
  runtime: 'federated-module',
  execution: 'frame',
  entryPath: 'dist/frame-settings.js',
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

  it('mounts host-renderer settings section contributions through isolated federated frames', () => {
    render(<SettingsContributionHost registry={registryWith([COMMAND_ENTRY, BASE_ENTRY])} />)

    const host = screen.getByLabelText('Extension settings contributions')
    expect(within(host).getByText('Extension settings')).toBeInTheDocument()
    expect(within(host).getByText('Sample settings')).toBeInTheDocument()
    expect(within(host).getByText('Federated module')).toBeInTheDocument()
    expect(within(host).getByText('Host renderer')).toBeInTheDocument()
    expect(within(host).getByTitle('Extension module: Sample settings')).toHaveAttribute(
      'sandbox',
      'allow-scripts',
    )
    expect(within(host).getByText('dist/settings.js')).toBeInTheDocument()
    expect(within(host).getByText('sample.configure')).toBeInTheDocument()
    expect(within(host).queryByText('Run sample')).not.toBeInTheDocument()
  })

  it('returns no host when the registry has no settings section contributions', () => {
    render(<SettingsContributionHost registry={registryWith([COMMAND_ENTRY])} />)

    expect(screen.queryByLabelText('Extension settings contributions')).not.toBeInTheDocument()
  })

  it('mounts frame execution contributions through the isolated federated frame host', () => {
    render(<SettingsContributionHost registry={registryWith([FRAME_ENTRY])} />)

    const host = screen.getByLabelText('Extension settings contributions')
    expect(within(host).getByText('Frame settings')).toBeInTheDocument()
    expect(within(host).getByText('Frame')).toBeInTheDocument()
    const frame = within(host).getByTitle('Extension module: Frame settings')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame).toHaveAttribute(
      'srcdoc',
      expect.stringContaining('&quot;execution&quot;:&quot;frame&quot;'),
    )
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
