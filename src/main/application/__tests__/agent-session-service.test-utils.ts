import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { ProviderService } from '../../ports/provider-service'
import { SettingsService } from '../../services/settings-service'

export const sessionServiceSession: SessionDetail = {
  id: SessionId('session-1'),
  title: 'Session 1',
  projectPath: '/tmp/project',
  piSessionId: 'pi-session-1',
  piSessionFile: '/tmp/pi-session-1.jsonl',
  messages: [],
  createdAt: 1,
  updatedAt: 2,
}

export const sessionServiceForkedSession: SessionDetail = {
  id: SessionId('pi-session-forked'),
  title: 'New session',
  projectPath: '/tmp/project',
  piSessionId: 'pi-session-forked',
  piSessionFile: '/tmp/pi-session-forked.jsonl',
  messages: [],
  createdAt: 3,
  updatedAt: 4,
}

export const sessionServiceProviderLayer = Layer.succeed(ProviderService, {
  get: () => Effect.succeed(undefined),
  getAll: () => Effect.succeed([]),
  getProviderForModel: () => Effect.dieMessage('getProviderForModel is not used'),
  isKnownModel: () => Effect.succeed(true),
})

export const sessionServiceSettingsLayer = Layer.succeed(SettingsService, {
  get: () => Effect.succeed(DEFAULT_SETTINGS),
  update: () => Effect.void,
  initialize: () => Effect.void,
  flushForTests: () => Effect.void,
})
