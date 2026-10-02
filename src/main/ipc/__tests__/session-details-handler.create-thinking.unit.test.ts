import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  dispatchLocalSessionCommandMock,
  getSessionDetailMock,
  loadSessionDetailsHandlers,
  resetSessionDetailsHandlerMocks,
} from './session-details-handler.test-harness'
import { getInvokeHandler } from './session-details-handler.test-layers'

function createdCommand() {
  const [input] = dispatchLocalSessionCommandMock.mock.calls[0] ?? []
  return input?.payload?.request?.command
}

describe('sessions:create thinking level', () => {
  let projectPath = ''
  let validatedProjectPath = ''

  beforeEach(async () => {
    resetSessionDetailsHandlerMocks()
    const { registerSessionDetailsHandlers } = await loadSessionDetailsHandlers()
    registerSessionDetailsHandlers()
    getSessionDetailMock.mockResolvedValue({
      id: SessionId('session-created'),
      title: 'New session',
      messages: [],
    })
    projectPath = await mkdtemp(path.join(tmpdir(), 'openwaggle-session-test-'))
    validatedProjectPath = await realpath(projectPath)
  })

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true })
  })

  it('creates the Session at the draft level, as a specialization of that Session only', async () => {
    await getInvokeHandler('sessions:create')?.(
      {},
      projectPath,
      undefined,
      SupportedModelId('openai/gpt-5.4'),
      'high',
    )

    // The only Host command is the create itself: no write of Pi's global default.
    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledTimes(1)
    expect(dispatchLocalSessionCommandMock.mock.calls[0]?.[0]).toMatchObject({
      payload: { contract: 'session-lifecycle-v2' },
    })
    expect(createdCommand()).toEqual({
      operation: 'create',
      projectPath: validatedProjectPath,
      workspace: { mode: 'local' },
      specialization: { modelId: 'openai/gpt-5.4', thinkingLevel: 'high' },
    })
  })

  it('accepts a level without a draft model', async () => {
    await getInvokeHandler('sessions:create')?.({}, projectPath, undefined, undefined, 'off')

    expect(createdCommand()).toMatchObject({ specialization: { thinkingLevel: 'off' } })
    expect(createdCommand()?.specialization).not.toHaveProperty('modelId')
  })

  it('refuses a level Pi does not define', async () => {
    await expect(
      getInvokeHandler('sessions:create')?.({}, projectPath, undefined, undefined, 'turbo'),
    ).rejects.toThrow('Thinking level must be one of')
    expect(dispatchLocalSessionCommandMock).not.toHaveBeenCalled()
  })

  it('leaves the Session on the default it starts from when no level is sent', async () => {
    await getInvokeHandler('sessions:create')?.({}, projectPath)

    expect(createdCommand()).not.toHaveProperty('specialization')
  })

  it('still refuses extra arguments', async () => {
    await expect(
      getInvokeHandler('sessions:create')?.({}, projectPath, undefined, undefined, 'low', 'extra'),
    ).rejects.toThrow()
    expect(dispatchLocalSessionCommandMock).not.toHaveBeenCalled()
  })
})
