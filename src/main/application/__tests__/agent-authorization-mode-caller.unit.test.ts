import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  getSessionDetail: vi.fn(),
  getSessionAuthorizationBoundary: vi.fn(),
  getSessionCallerAuthorizationBoundary: vi.fn(),
}))

vi.mock('../../store/session-details', () => store)
vi.mock('../../store/settings', () => ({
  getSettings: () => ({ defaultAuthorizationMode: 'yolo' }),
}))
vi.mock('../../config/project-config', () => ({
  getProjectPreferencesStrict: vi.fn(async () => undefined),
}))

const { resolveEffectiveAuthorizationMode } = await import('../agent-authorization-mode')

const YOLO_BOUNDARY = {
  execution_ceiling: 'yolo',
  grant_ceiling: null,
  profile_ceiling: null,
  profile_revoked_at: null,
  grant_revoked_at: null,
}

describe('Effective authorization mode under a Run initiator', () => {
  beforeEach(() => {
    store.getSessionDetail.mockResolvedValue({ projectPath: '/project', authorizationMode: 'yolo' })
    store.getSessionAuthorizationBoundary.mockResolvedValue(YOLO_BOUNDARY)
    store.getSessionCallerAuthorizationBoundary.mockReset()
  })

  it('asks for approval when the agent that started the Run is bounded to it', async () => {
    store.getSessionCallerAuthorizationBoundary.mockResolvedValue({
      authorizationCeiling: 'ask-for-approval',
      revoked: false,
    })

    await expect(
      resolveEffectiveAuthorizationMode(SessionId('session'), 'yolo', 'session-agent:s:r'),
    ).resolves.toBe('ask-for-approval')
    expect(store.getSessionCallerAuthorizationBoundary).toHaveBeenCalledWith('session-agent:s:r')
  })

  it('keeps the preferred mode when the Run initiator allows it', async () => {
    store.getSessionCallerAuthorizationBoundary.mockResolvedValue({
      authorizationCeiling: 'yolo',
      revoked: false,
    })

    await expect(
      resolveEffectiveAuthorizationMode(SessionId('session'), undefined, 'session-agent:s:r'),
    ).resolves.toBe('yolo')
  })

  it('asks for approval when the Run initiator was revoked', async () => {
    store.getSessionCallerAuthorizationBoundary.mockResolvedValue({
      authorizationCeiling: 'yolo',
      revoked: true,
    })

    await expect(
      resolveEffectiveAuthorizationMode(SessionId('session'), 'yolo', 'profile:gone'),
    ).resolves.toBe('ask-for-approval')
  })
})
