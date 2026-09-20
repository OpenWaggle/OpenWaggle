import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadSessionDetailsHandlers,
  resetSessionDetailsHandlerMocks,
} from './session-details-handler.test-harness'
import { getInvokeHandler } from './session-details-handler.test-layers'

describe('sessions:set-selected-model boundary', () => {
  let registerSessionDetailsHandlers: Awaited<
    ReturnType<typeof loadSessionDetailsHandlers>
  >['registerSessionDetailsHandlers']

  beforeEach(async () => {
    resetSessionDetailsHandlerMocks()
    ;({ registerSessionDetailsHandlers } = await loadSessionDetailsHandlers())
  })

  it('requires canonical provider/model references', async () => {
    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:set-selected-model')

    await expect(handler?.({}, SessionId('session-1'), 'not-a-ref')).rejects.toThrow(
      'Session model must be a provider/model reference.',
    )
    await expect(handler?.({}, SessionId('session-1'), ' provider/model ')).resolves.toBeUndefined()
  })
})
