import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import { Button } from '@/shared/ui/Button'
import { PiSessionContinuationPrompt } from '../../components/PiSessionContinuationPrompt'
import { PiSessionContinuationHeld } from '../../lib/pi-session-continuation'
import { composerSendFailureDisposition } from '../composer-send-failure'
import { usePiSessionContinuationGate } from '../usePiSessionContinuationGate'

const mocks = vi.hoisted(() => ({
  getSessionDetail: vi.fn(),
  updateSettings: vi.fn(),
  copyToClipboard: vi.fn(),
  runSessionTerminalCommand: vi.fn(),
}))
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSessionDetail: mocks.getSessionDetail,
    updateSettings: mocks.updateSettings,
    copyToClipboard: mocks.copyToClipboard,
  },
}))
vi.mock('@/features/terminal', () => ({
  runSessionTerminalCommand: mocks.runSessionTerminalCommand,
  terminalOwnerContext: (session: { readonly id: string }) => ({
    ownerKey: String(session.id),
    defaultCwd: '/projects/gosafe',
    defaultProvenance: 'opened-checkout',
  }),
}))

const SESSION_ID = SessionId('session-1')
const PROJECT = '/projects/gosafe'
const PI_FILE = '/home/me/.pi/agent/sessions/--projects-gosafe--/s.jsonl'

function session(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return fromPartial<SessionDetail>({
    id: SESSION_ID,
    title: 'Hooks QA',
    projectPath: PROJECT,
    piSessionFile: PI_FILE,
    piEntryNodeIdPrefix: `${SESSION_ID}/`,
    piSessionCwd: `${PROJECT}/packages/web`,
    messages: [],
    updatedAt: 1,
    ...overrides,
  })
}

const PAYLOAD = { text: 'Run the tests', attachments: [] }

function Harness({
  shown,
  send,
  onResult,
}: {
  readonly shown: SessionDetail
  readonly send: () => Promise<void>
  readonly onResult: (result: Promise<void> | false) => void
}) {
  const gatedSend = usePiSessionContinuationGate({
    activeSessionId: SESSION_ID,
    session: shown,
    send,
  })
  return (
    <>
      <Button onClick={() => onResult(gatedSend(PAYLOAD))}>Send</Button>
      <PiSessionContinuationPrompt />
    </>
  )
}

function renderGate(shown: SessionDetail) {
  const send = vi.fn(() => Promise.resolve())
  const results: (Promise<void> | false)[] = []
  render(<Harness shown={shown} send={send} onResult={(result) => results.push(result)} />)
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  const result = results[0]
  if (result === undefined) throw new Error('The gate returned nothing.')
  return { send, result }
}

beforeEach(() => {
  vi.clearAllMocks()
  usePreferencesStore.setState({ settings: { ...DEFAULT_SETTINGS, projectPath: PROJECT } })
  mocks.updateSettings.mockResolvedValue({ ok: true })
  mocks.runSessionTerminalCommand.mockReturnValue('terminal-1')
})

describe('usePiSessionContinuationGate', () => {
  it('asks before sending in a session pi used last, and continues in OpenWaggle', async () => {
    mocks.getSessionDetail.mockResolvedValue(session({ piSessionLastPromptOutside: true }))
    const { send, result } = renderGate(session())

    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue in OpenWaggle' }))

    await expect(result).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledWith(PAYLOAD)
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      piSessionContinuationByProject: { [PROJECT]: 'openwaggle' },
    })
  })

  it('keeps running in pi: types the command in the terminal and does not send', async () => {
    mocks.getSessionDetail.mockResolvedValue(session({ piSessionLastPromptOutside: true }))
    const { send, result } = renderGate(session())

    fireEvent.click(await screen.findByRole('button', { name: 'Keep running in pi' }))

    await expect(result).rejects.toBeInstanceOf(PiSessionContinuationHeld)
    expect(send).not.toHaveBeenCalled()
    expect(mocks.updateSettings).not.toHaveBeenCalled()
    expect(mocks.runSessionTerminalCommand).toHaveBeenCalledWith({
      ownerKey: String(SESSION_ID),
      cwd: `${PROJECT}/packages/web`,
      command: `pi --session '${PI_FILE}'`,
      title: 'pi',
      submit: false,
    })
  })

  it('sends at once when OpenWaggle wrote the session last', async () => {
    mocks.getSessionDetail.mockResolvedValue(session())
    const { send, result } = renderGate(session())

    await expect(result).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledWith(PAYLOAD)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('follows the choice remembered for the project without asking', async () => {
    usePreferencesStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        projectPath: PROJECT,
        piSessionContinuationByProject: { [PROJECT]: 'pi' },
      },
    })
    mocks.getSessionDetail.mockResolvedValue(session({ piSessionLastPromptOutside: true }))
    const { send, result } = renderGate(session())

    await expect(result).rejects.toMatchObject({ outcome: 'kept-in-pi' })
    expect(send).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('puts the message back when the prompt is dismissed', async () => {
    mocks.getSessionDetail.mockResolvedValue(session({ piSessionLastPromptOutside: true }))
    const { send, result } = renderGate(session())

    await screen.findByRole('button', { name: 'Continue in OpenWaggle' })
    const { usePiSessionContinuationStore } = await import(
      '../../state/pi-session-continuation-store'
    )
    act(() => usePiSessionContinuationStore.getState().answer(null))

    await expect(result).rejects.toMatchObject({ outcome: 'dismissed' })
    expect(send).not.toHaveBeenCalled()
  })

  it('never asks in a Session OpenWaggle created and wrote last', async () => {
    const created = session({ piEntryNodeIdPrefix: undefined })
    const { send } = renderGate(created)

    await waitFor(() => expect(send).toHaveBeenCalledWith(PAYLOAD))
    expect(mocks.getSessionDetail).not.toHaveBeenCalled()
  })

  it('puts a held message back in the composer with a short note', () => {
    expect(
      composerSendFailureDisposition(new PiSessionContinuationHeld('kept-in-pi'), SESSION_ID),
    ).toEqual({
      kind: 'restore',
      notice:
        'Kept in pi: press Enter in the terminal to continue there. Your message is back in the composer.',
    })
  })
})
