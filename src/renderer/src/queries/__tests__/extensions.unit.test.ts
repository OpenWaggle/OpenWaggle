import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extensionContributionsQueryOptions } from '../extensions'

const PROJECT_PATH = '/tmp/project'

const apiMock = vi.hoisted(() => ({
  acceptExtensionUpdate: vi.fn(),
  approveExtensionBuild: vi.fn(),
  listExtensionContributions: vi.fn(),
  listExtensionPackages: vi.fn(),
  reloadExtension: vi.fn(),
  setExtensionEnabled: vi.fn(),
  setExtensionProjectDisabled: vi.fn(),
  setExtensionTrusted: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

function queryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
}

describe('extensionContributionsQueryOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.listExtensionContributions.mockResolvedValue({
      projectPaths: [PROJECT_PATH],
      entries: [],
    })
  })

  it('omits session context for project-only contribution discovery', async () => {
    await queryClient().fetchQuery(extensionContributionsQueryOptions([PROJECT_PATH]))

    expect(apiMock.listExtensionContributions).toHaveBeenCalledWith({
      projectPaths: [PROJECT_PATH],
    })
  })

  it('includes session context when contribution discovery is session-scoped', async () => {
    await queryClient().fetchQuery(
      extensionContributionsQueryOptions([PROJECT_PATH], { sessionId: 'session-1' }),
    )

    expect(apiMock.listExtensionContributions).toHaveBeenCalledWith({
      projectPaths: [PROJECT_PATH],
      sessionId: 'session-1',
    })
  })
})
