import { SupportedModelId, WagglePresetId } from '@shared/types/brand'
import type { WagglePreset } from '@shared/types/waggle'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { LexicalEditor } from 'lexical'
import { act, createRef, type RefObject } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  insertSkillReferenceAtActiveSlash,
  insertWagglePresetAtActiveSlash,
  setEditorText,
} from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { LexicalComposerEditor } from '../LexicalComposerEditor'

vi.mock('@/features/sessions/hooks', () => ({
  useProject: () => ({ projectPath: null }),
}))

function requireEditor(editorRef: RefObject<LexicalEditor | null>) {
  if (!editorRef.current) throw new Error('Expected Lexical editor')
  return editorRef.current
}

function reviewPreset(): WagglePreset {
  return {
    id: WagglePresetId('review'),
    name: 'Review',
    description: 'Review the implementation',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Architect',
          model: SupportedModelId('openai/gpt-5.5'),
          roleDescription: 'Reviews architecture',
          color: 'blue',
        },
        {
          label: 'Reviewer',
          model: SupportedModelId('anthropic/claude-sonnet-4'),
          roleDescription: 'Challenges findings',
          color: 'amber',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: 4 },
    },
    isBuiltIn: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('LexicalComposerEditor', () => {
  beforeAll(() => {
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  })

  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
  })

  it('submits the preserved prompt with the serialized slash skill reference', async () => {
    const editorRef = createRef<LexicalEditor>()
    const onSubmit = vi.fn()
    render(
      <LexicalComposerEditor
        onSubmit={onSubmit}
        placeholder="Ask"
        editorRef={editorRef}
        checkAndConvertPaste={vi.fn(() => false)}
      />,
    )
    await waitFor(() => expect(editorRef.current).not.toBeNull())

    act(() => setEditorText(requireEditor(editorRef), 'Keep the existing prompt /cav'))
    await waitFor(() =>
      expect(useComposerStore.getState().input).toBe('Keep the existing prompt /cav'),
    )
    act(() => insertSkillReferenceAtActiveSlash('caveman', 'Caveman'))
    await waitFor(() =>
      expect(useComposerStore.getState().input).toBe('Keep the existing prompt /caveman '),
    )

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message input' }), {
      key: 'Enter',
    })

    expect(onSubmit).toHaveBeenCalledWith('Keep the existing prompt /caveman ')
  })

  it('updates Lexical editability when disabled changes after mount', async () => {
    const editorRef = createRef<LexicalEditor>()
    const props = {
      onSubmit: vi.fn(),
      placeholder: 'Ask',
      editorRef,
      checkAndConvertPaste: vi.fn(() => false),
    }
    const { rerender } = render(<LexicalComposerEditor {...props} />)
    await waitFor(() => expect(editorRef.current?.isEditable()).toBe(true))

    rerender(<LexicalComposerEditor {...props} disabled />)

    await waitFor(() => expect(editorRef.current?.isEditable()).toBe(false))
  })

  it('preserves the prompt and renders a one-shot Waggle preset as a chip', async () => {
    const editorRef = createRef<LexicalEditor>()
    const onSubmit = vi.fn()
    render(
      <LexicalComposerEditor
        onSubmit={onSubmit}
        placeholder="Ask"
        editorRef={editorRef}
        checkAndConvertPaste={vi.fn(() => false)}
      />,
    )
    await waitFor(() => expect(editorRef.current).not.toBeNull())

    act(() => setEditorText(requireEditor(editorRef), 'Keep this prompt /rev'))
    await waitFor(() => expect(useComposerStore.getState().input).toBe('Keep this prompt /rev'))
    act(() => insertWagglePresetAtActiveSlash(reviewPreset()))

    await waitFor(() => {
      expect(screen.getByText('Review')).toBeInTheDocument()
      expect(useComposerStore.getState().input).toBe('Keep this prompt ')
      expect(useComposerStore.getState().selectedWagglePreset?.id).toBe(WagglePresetId('review'))
    })

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message input' }), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('Keep this prompt ')
  })
})
