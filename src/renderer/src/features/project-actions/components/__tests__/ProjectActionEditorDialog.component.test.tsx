import type { ProjectAction, ProjectActionInput } from '@shared/types/project-actions'
import { DEFAULT_SHORTCUT_BINDINGS } from '@shared/types/shortcuts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { ProjectActionEditorDialog } from '../ProjectActionEditorDialog'

const mocks = vi.hoisted(() => ({ showConfirm: vi.fn() }))

vi.mock('@/shared/lib/ipc', () => ({ api: { showConfirm: mocks.showConfirm } }))

const ACTION: ProjectAction = {
  id: 'test',
  name: 'Test',
  command: 'pnpm test',
  icon: 'test',
  runOnWorktreeCreate: false,
}

function renderEditor(
  options: {
    readonly action?: ProjectAction | null
    readonly actions?: readonly ProjectAction[]
    readonly onSave?: Mock<(input: ProjectActionInput) => Promise<void>>
    readonly onDelete?: Mock<(actionId: string) => Promise<void>>
    readonly onClose?: Mock<() => void>
  } = {},
) {
  const onSave = options.onSave ?? vi.fn<(input: ProjectActionInput) => Promise<void>>()
  const onDelete = options.onDelete ?? vi.fn<(actionId: string) => Promise<void>>()
  const onClose = options.onClose ?? vi.fn<() => void>()
  render(
    <ProjectActionEditorDialog
      action={options.action ?? null}
      actions={options.actions ?? []}
      builtInBindings={DEFAULT_SHORTCUT_BINDINGS}
      saving={false}
      onSave={onSave}
      onDelete={onDelete}
      onClose={onClose}
    />,
  )
  return { onSave, onDelete, onClose }
}

describe('ProjectActionEditorDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.showConfirm.mockResolvedValue(true)
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Linux x86_64',
    })
  })

  it('validates inline and persists a canonical scheme-less preview address', async () => {
    const { onSave, onClose } = renderEditor()

    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Name is required.')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dev' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'pnpm dev' } })
    fireEvent.change(screen.getByLabelText('Preview URL (optional)'), {
      target: { value: 'localhost:5173/app' },
    })
    fireEvent.click(screen.getByRole('switch', { name: 'Open preview automatically' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledExactlyOnceWith({
        name: 'Dev',
        command: 'pnpm dev',
        icon: 'play',
        runOnWorktreeCreate: false,
        previewUrl: 'http://localhost:5173/app',
        autoOpenPreview: true,
        shortcutRules: [],
      }),
    )
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('warns about overlaps without blocking the T3-style last-binding-wins behavior', async () => {
    const { onSave, onClose } = renderEditor()
    const recorder = screen.getByRole('button', { name: 'Record binding 1' })

    fireEvent.keyDown(recorder, { key: 'j', code: 'KeyJ', ctrlKey: true })

    expect(screen.getByText(/May overlap “Toggle terminal”/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dev' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'pnpm dev' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          shortcutRules: [{ shortcut: { key: 'J', mod: true } }],
        }),
      ),
    )
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('leaves Tab available for keyboard navigation from the shortcut recorder', () => {
    renderEditor()
    const recorder = screen.getByRole('button', { name: 'Record binding 1' })
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      code: 'Tab',
      bubbles: true,
      cancelable: true,
    })

    recorder.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('adds, conditions, and saves multiple ordered bindings', async () => {
    const { onSave } = renderEditor()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dev' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'pnpm dev' } })

    fireEvent.keyDown(screen.getByRole('button', { name: 'Record binding 1' }), {
      key: 'd',
      code: 'KeyD',
      ctrlKey: true,
    })
    fireEvent.change(screen.getByLabelText('Condition for binding 1'), {
      target: { value: 'terminalFoc' },
    })
    expect(screen.getAllByText(/Unknown context “terminalFoc”/).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Condition for binding 1'), {
      target: { value: 'terminalFocus' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add binding' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Record binding 2' }), {
      key: 'd',
      code: 'KeyD',
      ctrlKey: true,
      shiftKey: true,
    })
    fireEvent.change(screen.getByLabelText('Condition for binding 2'), {
      target: { value: '!terminalFocus' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          shortcutRules: [
            { shortcut: { key: 'D', mod: true }, when: 'terminalFocus' },
            { shortcut: { key: 'D', mod: true, shift: true }, when: '!terminalFocus' },
          ],
        }),
      ),
    )
  })

  it('requires confirmation before deleting an existing action', async () => {
    const { onDelete, onClose } = renderEditor({ action: ACTION, actions: [ACTION] })

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(mocks.showConfirm).toHaveBeenCalledExactlyOnceWith(
        'Delete action “Test”?',
        'This action cannot be undone.',
      ),
    )
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('test')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
