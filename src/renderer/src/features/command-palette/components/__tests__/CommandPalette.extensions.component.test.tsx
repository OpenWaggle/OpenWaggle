import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SupportedModelId } from '@shared/types/brand'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { usePreferencesStore } from '@/features/settings/state'
import { CommandPalette } from '../CommandPalette'

const PROJECT_PATH = '/tmp/project'
const apiMock = vi.hoisted(() => ({
  listExtensionCommands: vi.fn(),
  listExtensionContributions: vi.fn(),
  listWagglePresets: vi.fn(),
}))

const HANDOFF_SKILL: SkillDiscoveryItem = {
  id: 'handoff',
  name: 'handoff',
  description: 'Compact the current conversation into a handoff document',
  folderPath: '/tmp/project/.agents/skills/handoff',
  skillPath: '/tmp/project/.agents/skills/handoff/SKILL.md',
  hasScripts: false,
  enabled: true,
  loadStatus: 'ok',
}

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

function renderPalette(slashSkills: readonly SkillDiscoveryItem[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandPalette slashSkills={slashSkills} onSelectSkill={vi.fn()} onStartWaggle={vi.fn()} />
    </QueryClientProvider>,
  )
}

function sampleEntry(
  family: ExtensionContributionRegistryEntry['family'],
  contributionId: string,
  label: string,
) {
  const entry: ExtensionContributionRegistryEntry = {
    extensionId: 'sample-extension',
    extensionName: 'Sample Extension',
    extensionVersion: '1.0.0',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND, label: 'Global' },
    packagePath: '/tmp/extensions/sample-extension',
    manifestPath: '/tmp/extensions/sample-extension/openwaggle.extension.json',
    contentHash: 'abcdef',
    projectPaths: [PROJECT_PATH],
    appliesToAllRequestedProjects: true,
    family,
    contributionId,
    title: label,
    label,
    category: 'Sample',
    capability: 'sample.execute',
    method: 'run',
    declaredScopes: ['project'],
    eligibility: {
      runtimeEnabled: true,
      enabled: true,
      trusted: true,
      sdkCompatible: true,
      updateAvailable: false,
      disabledProjectPaths: [],
    },
    diagnostics: [],
    ...(family === OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS
      ? {
          runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
          execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
          entryPath: 'modules/side-panel.js',
        }
      : {}),
  }
  return entry
}

describe('composer slash extension contributions', () => {
  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    useComposerStore.setState({
      input: '/',
      cursorIndex: 1,
      activeSlashCommand: { query: '', token: 'test:0:' },
    })
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, projectPath: PROJECT_PATH },
      isLoaded: true,
      loadError: null,
    })
    apiMock.listWagglePresets.mockResolvedValue([])
    apiMock.listExtensionContributions.mockResolvedValue({
      projectPaths: [PROJECT_PATH],
      entries: [
        sampleEntry(
          OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SLASH_COMMANDS,
          'sample.slash',
          'Run sample slash',
        ),
        sampleEntry(
          OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS,
          'sample.command',
          'Run global command',
        ),
        sampleEntry(
          OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
          'sample.panel',
          'Open global panel',
        ),
      ],
    })
  })

  it('keeps filtering in the composer instead of rendering a second search input', () => {
    renderPalette()
    expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument()
  })

  it('lists only composer-native slash contributions', async () => {
    renderPalette()

    fireEvent.click(await screen.findByRole('menuitem', { name: /run sample slash/i }))

    expect(useComposerStore.getState().input).toBe('/sample.slash ')
    expect(screen.queryByRole('menuitem', { name: /run global command/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /open global panel/i })).not.toBeInTheDocument()
  })

  it('lists an enabled skill instead of the Pi extension command that shares its name', async () => {
    apiMock.listExtensionCommands.mockResolvedValue([
      { name: 'handoff', description: 'An extension handoff' },
      { name: 'qa-probe', description: 'A control command' },
    ])

    // The commands query needs a model; the default settings carry an empty reference.
    usePreferencesStore.setState({
      settings: {
        ...usePreferencesStore.getState().settings,
        selectedModel: SupportedModelId('anthropic/claude-sonnet-4-5'),
      },
    })

    renderPalette([HANDOFF_SKILL])

    expect(await screen.findByRole('menuitem', { name: /a control command/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /into a handoff do/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: /an extension handoff/i }),
    ).not.toBeInTheDocument()
  })
})
