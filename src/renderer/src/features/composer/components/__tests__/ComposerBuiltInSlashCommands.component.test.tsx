import type { SkillDiscoveryItem } from '@shared/types/standards'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { LexicalEditor } from 'lexical'
import { createRef, type RefObject } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette } from '@/features/command-palette/components'
import { setEditorText } from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { useUIStore } from '@/shell/ui-store'
import { LexicalComposerEditor } from '../LexicalComposerEditor'

const apiMock = vi.hoisted(() => ({
  listExtensionContributions: vi.fn(),
  listWagglePresets: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/features/sessions/hooks', () => ({
  useProject: () => ({ projectPath: null }),
}))

// Mirrors the gosafe project skill whose description made "/compact" select a skill on Enter.
const HANDOFF_SKILL: SkillDiscoveryItem = {
  id: 'handoff',
  name: 'handoff',
  description: 'Compact the current conversation into a handoff document for another agent.',
  folderPath: '/project/.agents/skills/handoff',
  skillPath: '/project/.agents/skills/handoff/SKILL.md',
  hasScripts: false,
  enabled: true,
  loadStatus: 'ok',
}

function requireEditor(editorRef: RefObject<LexicalEditor | null>) {
  if (!editorRef.current) throw new Error('Expected Lexical editor')
  return editorRef.current
}

function SlashMenu(props: {
  readonly onSelectSkill: (skillId: string, skillName?: string) => void
}) {
  const open = useUIStore((state) => state.slashCommandMenuOpen)
  if (!open) return null
  return (
    <CommandPalette
      slashSkills={[HANDOFF_SKILL]}
      onSelectSkill={props.onSelectSkill}
      onStartWaggle={vi.fn()}
    />
  )
}

function renderComposer() {
  const editorRef = createRef<LexicalEditor>()
  const onSubmit = vi.fn()
  const onSelectSkill = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LexicalComposerEditor
        onSubmit={onSubmit}
        placeholder="Ask"
        editorRef={editorRef}
        checkAndConvertPaste={vi.fn(() => false)}
      />
      <SlashMenu onSelectSkill={onSelectSkill} />
    </QueryClientProvider>,
  )
  return { editorRef, onSubmit, onSelectSkill }
}

async function typeIntoComposer(editorRef: RefObject<LexicalEditor | null>, text: string) {
  await waitFor(() => expect(editorRef.current).not.toBeNull())
  act(() => setEditorText(requireEditor(editorRef), text))
  await waitFor(() => expect(useComposerStore.getState().input).toBe(text))
}

function pressKey(key: string) {
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message input' }), { key })
}

describe('composer built-in slash commands', () => {
  beforeAll(() => {
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  })

  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    useUIStore.getState().closeSlashCommandMenu()
    apiMock.listWagglePresets.mockResolvedValue([])
    apiMock.listExtensionContributions.mockResolvedValue({ projectPaths: [], entries: [] })
  })

  it('submits a fully typed /compact instead of selecting a skill that mentions compact', async () => {
    const { editorRef, onSubmit, onSelectSkill } = renderComposer()
    await typeIntoComposer(editorRef, '/compact')

    expect(await screen.findByRole('menuitem', { name: /compact session/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /handoff/i })).toBeInTheDocument()

    pressKey('Enter')

    expect(onSelectSkill).not.toHaveBeenCalled()
    expect(onSubmit).toHaveBeenCalledWith('/compact')
  })

  it('completes a partial /compact on Enter so custom instructions can be added', async () => {
    const { editorRef, onSubmit, onSelectSkill } = renderComposer()
    await typeIntoComposer(editorRef, '/comp')
    await screen.findByRole('menuitem', { name: /compact session/i })

    pressKey('Enter')

    await waitFor(() => expect(useComposerStore.getState().input).toBe('/compact '))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onSelectSkill).not.toHaveBeenCalled()
    await waitFor(() => expect(useUIStore.getState().slashCommandMenuOpen).toBe(false))
  })

  it('still lets the user pick the matching skill with the arrow keys', async () => {
    const { editorRef, onSubmit, onSelectSkill } = renderComposer()
    await typeIntoComposer(editorRef, '/compact')
    await screen.findByRole('menuitem', { name: /compact session/i })

    pressKey('ArrowDown')
    pressKey('Enter')

    expect(onSelectSkill).toHaveBeenCalledWith('handoff', 'handoff')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not submit a draft that only mentions /compact after other text', async () => {
    const { editorRef, onSubmit } = renderComposer()
    await typeIntoComposer(editorRef, 'please summarize then /compact')
    await screen.findByRole('menuitem', { name: /compact session/i })

    pressKey('Enter')

    expect(onSubmit).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(useComposerStore.getState().input).toBe('please summarize then /compact '),
    )
  })

  it('completes a differently cased command instead of sending it to the model', async () => {
    const { editorRef, onSubmit } = renderComposer()
    await typeIntoComposer(editorRef, '/Compact')
    await screen.findByRole('menuitem', { name: /compact session/i })

    pressKey('Enter')

    expect(onSubmit).not.toHaveBeenCalled()
    await waitFor(() => expect(useComposerStore.getState().input).toBe('/compact '))
  })

  it('completes a fully typed /compact on Tab so instructions can follow', async () => {
    const { editorRef, onSubmit } = renderComposer()
    await typeIntoComposer(editorRef, '/compact')
    await screen.findByRole('menuitem', { name: /compact session/i })

    pressKey('Tab')

    expect(onSubmit).not.toHaveBeenCalled()
    await waitFor(() => expect(useComposerStore.getState().input).toBe('/compact '))
  })

  it('submits a fully typed /fork or /clone on Enter', async () => {
    const { editorRef, onSubmit } = renderComposer()
    await typeIntoComposer(editorRef, '/fork')
    await screen.findByRole('menuitem', { name: /fork session/i })
    pressKey('Enter')
    expect(onSubmit).toHaveBeenLastCalledWith('/fork')

    await typeIntoComposer(editorRef, '/clone')
    await screen.findByRole('menuitem', { name: /clone session/i })
    pressKey('Enter')
    expect(onSubmit).toHaveBeenLastCalledWith('/clone')
  })

  it('keeps built-in commands out of the skills-only chooser', async () => {
    const { editorRef } = renderComposer()
    await typeIntoComposer(editorRef, '/compact')
    act(() => useComposerStore.getState().setSlashMenuFilter('skills'))

    expect(await screen.findByRole('menuitem', { name: /handoff/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /compact session/i })).not.toBeInTheDocument()
  })
})
