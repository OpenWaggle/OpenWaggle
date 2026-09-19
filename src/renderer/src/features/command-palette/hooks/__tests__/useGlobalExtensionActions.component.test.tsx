import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  invokeExtension: vi.fn(),
  navigate: vi.fn(),
  setLastRightSidebarPanel: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/shared/lib/ipc', () => ({ api: { invokeExtension: mocks.invokeExtension } }))
vi.mock('@/shell/ui-store', () => ({
  EXTENSION_SIDE_PANEL_ROUTE_PANEL: 'extension-side-panel',
  useUIStore: (
    selector: (state: {
      closeCommandSurface: typeof mocks.close
      setLastRightSidebarPanel: typeof mocks.setLastRightSidebarPanel
      showToast: typeof mocks.showToast
    }) => unknown,
  ) =>
    selector({
      closeCommandSurface: mocks.close,
      setLastRightSidebarPanel: mocks.setLastRightSidebarPanel,
      showToast: mocks.showToast,
    }),
}))

import { useGlobalExtensionActions } from '../useGlobalExtensionActions'

const PROJECT_PATH = '/tmp/project'

function commandEntry(): ExtensionContributionRegistryEntry {
  return {
    extensionId: 'sample-extension',
    extensionName: 'Sample Extension',
    extensionVersion: '1.0.0',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND, label: 'Global' },
    packagePath: '/tmp/extensions/sample-extension',
    manifestPath: '/tmp/extensions/sample-extension/openwaggle.extension.json',
    contentHash: 'content-hash',
    projectPaths: [PROJECT_PATH],
    appliesToAllRequestedProjects: true,
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS,
    contributionId: 'sample.run',
    title: 'Run sample',
    label: 'Run sample',
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
    declaredScopes: ['session'],
    eligibility: {
      runtimeEnabled: true,
      enabled: true,
      trusted: true,
      sdkCompatible: true,
      updateAvailable: false,
      disabledProjectPaths: [],
    },
    diagnostics: [],
    invocationBinding: 'host-issued-binding',
  }
}

describe('useGlobalExtensionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.invokeExtension.mockResolvedValue({
      ok: false,
      error: { code: 'unsupported-capability', message: 'Stopped by test.' },
    })
  })

  it('forwards the mounted contribution binding through the command palette transport', async () => {
    const { result } = renderHook(() =>
      useGlobalExtensionActions({ projectPath: PROJECT_PATH, sessionId: 'session-one' }),
    )

    act(() => result.current.invokeExtensionCommand({ entry: commandEntry() }))

    await waitFor(() =>
      expect(mocks.invokeExtension).toHaveBeenCalledWith(
        {
          extensionId: 'sample-extension',
          contributionId: 'sample.run',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
          scope: { kind: 'session', projectPath: PROJECT_PATH, sessionId: 'session-one' },
          payload: {},
        },
        'host-issued-binding',
      ),
    )
  })
})
