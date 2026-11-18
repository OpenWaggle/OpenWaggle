import { SessionId, SupportedModelId } from '@shared/types/brand'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extensionCommandsQueryOptions } from '../extension-commands'

const { listExtensionCommands } = vi.hoisted(() => ({ listExtensionCommands: vi.fn() }))

vi.mock('@/shared/lib/ipc', () => ({ api: { listExtensionCommands } }))

/*
 * The slash menu lists Pi extension commands for the Session shown, and for a New session draft,
 * which has no Session yet, those of its project.
 */

const MODEL = SupportedModelId('openai/gpt-5.5')

describe('extensionCommandsQueryOptions', () => {
  beforeEach(() => {
    listExtensionCommands.mockReset()
    listExtensionCommands.mockResolvedValue([{ name: 'qa-hello' }])
  })

  it('reads the commands of the Session shown', async () => {
    const queryClient = new QueryClient()

    await queryClient.query(extensionCommandsQueryOptions(SessionId('s1'), MODEL, '/repo'))

    expect(listExtensionCommands).toHaveBeenCalledWith(SessionId('s1'), MODEL)
  })

  it('reads the commands of its project for a New session draft', async () => {
    const queryClient = new QueryClient()
    const options = extensionCommandsQueryOptions(null, MODEL, '/repo')

    expect(options.enabled).toBe(true)
    await expect(queryClient.query(options)).resolves.toEqual([{ name: 'qa-hello' }])
    expect(listExtensionCommands).toHaveBeenCalledWith(null, MODEL, '/repo')
  })

  it('reads nothing with no Session, no project or no model', () => {
    expect(extensionCommandsQueryOptions(null, MODEL, null).enabled).toBe(false)
    expect(extensionCommandsQueryOptions(SessionId('s1'), null, '/repo').enabled).toBe(false)
  })
})
