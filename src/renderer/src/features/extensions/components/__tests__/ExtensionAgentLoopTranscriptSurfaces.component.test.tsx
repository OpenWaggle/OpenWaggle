import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionAgentLoopSurface } from '../ExtensionAgentLoopSurface'

const PROJECT_PATH = '/tmp/project'
const EXTENSION_FRAME_URL_PREFIX = 'openwaggle-extension-frame://frame/frames/'

const apiMock = vi.hoisted(() => ({
  registerExtensionFrame: vi.fn(),
  unregisterExtensionFrame: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

function transcriptEntry(input: {
  readonly contributionId: string
  readonly title: string
  readonly entryPath: string
}): ExtensionContributionRegistryEntry {
  return {
    extensionId: 'github-fixture',
    extensionName: 'GitHub Fixture',
    extensionVersion: '1.0.0',
    scope: {
      kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
      label: 'Project',
      projectPath: PROJECT_PATH,
    },
    packagePath: '/tmp/project/.openwaggle/extensions/github-fixture',
    manifestPath: '/tmp/project/.openwaggle/extensions/github-fixture/openwaggle.extension.json',
    contentHash: 'abcdef',
    projectPaths: [PROJECT_PATH],
    appliesToAllRequestedProjects: true,
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TRANSCRIPT_RENDERERS,
    contributionId: input.contributionId,
    title: input.title,
    label: input.title,
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: input.entryPath,
    matches: {},
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
}

describe('ExtensionAgentLoopSurface transcript renderers', () => {
  beforeEach(() => {
    apiMock.registerExtensionFrame.mockReset()
    apiMock.unregisterExtensionFrame.mockReset()
    apiMock.registerExtensionFrame.mockImplementation((input: { readonly frameId: string }) =>
      Promise.resolve({
        frameUrl: `${EXTENSION_FRAME_URL_PREFIX}${encodeURIComponent(input.frameId)}/index.html`,
        registrationId: `registration-${input.frameId}`,
      }),
    )
    apiMock.unregisterExtensionFrame.mockResolvedValue(undefined)
  })

  it('mounts multiple transcript renderer contributions for the same transcript surface', async () => {
    const firstTranscriptEntry = transcriptEntry({
      contributionId: 'github.transcript-primary',
      title: 'GitHub primary transcript',
      entryPath: 'dist/transcript-primary.js',
    })
    const secondTranscriptEntry = transcriptEntry({
      contributionId: 'github.transcript-secondary',
      title: 'GitHub secondary transcript',
      entryPath: 'dist/transcript-secondary.js',
    })

    render(
      <ExtensionAgentLoopSurface
        fallback={null}
        input={{
          surface: 'transcript',
          transcript: {
            sessionId: 'session-1',
            projectPaths: [PROJECT_PATH],
            messageCount: 3,
            state: 'active',
          },
        }}
        projectPaths={[PROJECT_PATH]}
        registry={{
          projectPaths: [PROJECT_PATH],
          entries: [firstTranscriptEntry, secondTranscriptEntry],
        }}
      />,
    )

    expect(screen.getByLabelText('Transcript extension renderers')).toBeInTheDocument()

    const firstFrame = screen.getByTitle('Extension module: GitHub primary transcript')
    const secondFrame = screen.getByTitle('Extension module: GitHub secondary transcript')
    await waitFor(() => {
      expect(firstFrame).toHaveAttribute('src', expect.stringContaining(EXTENSION_FRAME_URL_PREFIX))
      expect(secondFrame).toHaveAttribute(
        'src',
        expect.stringContaining(EXTENSION_FRAME_URL_PREFIX),
      )
    })
    expect(screen.getByText('GitHub primary transcript')).toBeInTheDocument()
    expect(screen.getByText('GitHub secondary transcript')).toBeInTheDocument()
  })
})
