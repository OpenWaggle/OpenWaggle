import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const api = vi.hoisted(() => ({
  listMcpSecrets: vi.fn(),
  setMcpSecret: vi.fn(),
  removeMcpSecret: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

import { McpSecretsPanel } from '../McpSecretsPanel'

async function save(name: string, value: string) {
  const form = await screen.findByRole('form', { name: 'Add secret' })
  fireEvent.change(within(form).getByLabelText('Secret name'), { target: { value: name } })
  fireEvent.change(within(form).getByLabelText('Secret value'), { target: { value } })
  fireEvent.click(within(form).getByRole('button', { name: /Save/ }))
  return form
}

describe('Settings > MCP > Secrets', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.listMcpSecrets.mockResolvedValue([])
  })

  it('says it is saving while the system keychain is asked', async () => {
    api.setMcpSecret.mockReturnValue(new Promise(() => {}))
    renderWithQueryClient(<McpSecretsPanel />)

    const form = await save('TOKEN', 'value')

    expect(await within(form).findByRole('button', { name: 'Saving…' })).toBeDisabled()
  })

  it('says why a save failed, such as a keychain that did not answer', async () => {
    api.setMcpSecret.mockRejectedValue(
      new Error(
        'The system keychain did not answer within 20 s, so the MCP secret could not be read or saved.',
      ),
    )
    renderWithQueryClient(<McpSecretsPanel />)

    const form = await save('TOKEN', 'value')

    expect(await screen.findByText(/The system keychain did not answer within 20 s/)).toBeVisible()
    expect(within(form).getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})
