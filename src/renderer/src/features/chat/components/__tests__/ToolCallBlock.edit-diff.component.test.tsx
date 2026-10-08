import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings'
import { ChatDisplayPathProvider } from '../ChatDisplayPathContext'
import { ToolCallBlock } from '../ToolCallBlock'

const mockCopyToClipboard = vi.hoisted(() => vi.fn())
const mockOpenWorkspaceFile = vi.hoisted(() => vi.fn())
const UNRENDERABLE_MARKER = 'pierre-rejects-this'
const SUSPEND_MARKER = 'still-loading'
const diffLoad = vi.hoisted(() => {
  let release: () => void = () => undefined
  const ready = { done: false }
  const promise = new Promise<void>((resolve) => {
    release = () => {
      ready.done = true
      resolve()
    }
  })
  return { promise, ready, release: () => release() }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
  },
}))

vi.mock('@/features/workspace-files/hooks', () => ({
  useOpenWorkspaceFile: () => mockOpenWorkspaceFile,
}))

// The real DiffBlock pulls in Pierre and the syntax runtime; a stub keeps the lazy
// import instant and exposes the options the card passes.
vi.mock('@/shared/ui/DiffBlock', () => ({
  DiffBlock: ({
    patch,
    view,
    wrap,
    embedded,
  }: {
    readonly patch: string
    readonly view: string
    readonly wrap: boolean
    readonly embedded?: boolean
  }) => {
    if (patch.includes(UNRENDERABLE_MARKER)) throw new Error('must contain exactly 1 file diff')
    if (patch.includes(SUSPEND_MARKER) && !diffLoad.ready.done) throw diffLoad.promise
    return (
      <pre
        data-testid="patch-diff"
        data-view={view}
        data-wrap={String(wrap)}
        data-embedded={String(embedded)}
      >
        {patch}
      </pre>
    )
  },
}))

const WORKTREE = '/Users/me/.openwaggle/worktrees/app/abc'
const PROJECT = '/Users/me/projects/app'
const EDIT_PATCH = [
  '--- src/geo.ts',
  '+++ src/geo.ts',
  '@@ -10,3 +10,3 @@',
  ' const one = 1',
  '-const old = 3',
  '+const next = 3',
  ' export {}',
  '',
].join('\n')

function editArgs(path: string) {
  return JSON.stringify({ path, edits: [{ oldText: 'const old = 3', newText: 'const next = 3' }] })
}

function editResult(details: { readonly [key: string]: unknown }) {
  return {
    content: {
      content: [{ type: 'text', text: 'Successfully replaced 1 block(s) in src/geo.ts.' }],
      details,
    },
    state: 'complete',
  }
}

function renderEdit({
  path = 'src/geo.ts',
  details = { patch: EDIT_PATCH, firstChangedLine: 11 },
  workingPath = WORKTREE,
}: {
  readonly path?: string
  readonly details?: { readonly [key: string]: unknown }
  readonly workingPath?: string | null
} = {}) {
  const args = editArgs(path)
  render(
    <ChatDisplayPathProvider
      projectPath={PROJECT}
      worktreePath={WORKTREE}
      workingPath={workingPath}
    >
      <ToolCallBlock name="edit" args={args} state="complete" result={editResult(details)} />
    </ChatDisplayPathProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: /^Edited / }))
  return { args }
}

describe('ToolCallBlock edit diffs (ADR 0050)', () => {
  beforeEach(() => {
    mockCopyToClipboard.mockReset()
    mockOpenWorkspaceFile.mockReset()
    usePreferencesStore.setState({ settings: DEFAULT_SETTINGS })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the file diff instead of raw arguments when an edit row expands', async () => {
    const { args } = renderEdit({
      details: { diff: 'display', patch: EDIT_PATCH, firstChangedLine: 11 },
    })

    const diff = await screen.findByTestId('patch-diff')
    expect(diff).toHaveTextContent('+const next = 3')
    expect(diff).toHaveAttribute('data-view', 'unified')
    expect(diff).toHaveAttribute('data-embedded', 'true')
    expect(screen.queryByText('Arguments')).toBeNull()
    expect(screen.queryByText(/Successfully replaced/)).toBeNull()
    expect(
      screen.getByRole('button', {
        name: 'Edited src/geo.ts, 1 addition, 1 deletion — collapse details',
      }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy diff' }))
    expect(mockCopyToClipboard).toHaveBeenLastCalledWith(EDIT_PATCH)
    fireEvent.click(screen.getByRole('button', { name: 'Copy args' }))
    expect(mockCopyToClipboard).toHaveBeenLastCalledWith(args)
  })

  it('stays collapsed until the row is expanded', () => {
    render(
      <ToolCallBlock
        name="edit"
        args={editArgs('src/geo.ts')}
        state="complete"
        result={editResult({ patch: EDIT_PATCH })}
      />,
    )

    expect(screen.queryByTestId('patch-diff')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy diff' })).toBeNull()
  })

  it('follows the wrap-lines preference but always uses the unified layout', async () => {
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, diffView: 'split', diffWrapLines: true },
    })

    renderEdit()

    const diff = await screen.findByTestId('patch-diff')
    expect(diff).toHaveAttribute('data-wrap', 'true')
    expect(diff).toHaveAttribute('data-view', 'unified')
  })

  it('opens the edited file at its first changed line', () => {
    renderEdit({ workingPath: WORKTREE })

    fireEvent.click(screen.getByRole('button', { name: 'Open src/geo.ts' }))

    expect(mockOpenWorkspaceFile).toHaveBeenCalledWith('src/geo.ts', 11)
  })

  it('does not offer to open a file when the Session has no working root', () => {
    renderEdit({ workingPath: null })

    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull()
  })

  it('announces a loading state until the diff renderer is ready', async () => {
    renderEdit({ details: { patch: `${EDIT_PATCH}${SUSPEND_MARKER}` } })

    expect(await screen.findByRole('status')).toHaveTextContent('Loading diff…')
    await act(async () => diffLoad.release())

    expect(await screen.findByTestId('patch-diff')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('opens an absolute path inside the working root relative to it', () => {
    renderEdit({ path: `${WORKTREE}/src/geo.ts`, workingPath: WORKTREE })

    fireEvent.click(screen.getByRole('button', { name: 'Open src/geo.ts' }))

    expect(mockOpenWorkspaceFile).toHaveBeenCalledWith('src/geo.ts', 11)
  })

  it('does not offer to open a project-root file from a worktree Session', () => {
    renderEdit({ path: `${PROJECT}/src/geo.ts`, workingPath: WORKTREE })

    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull()
    expect(screen.getByTitle('src/geo.ts')).toHaveTextContent('geo.ts')
  })

  it('does not offer to open a file outside the workspace', () => {
    renderEdit({ path: '/etc/hosts', workingPath: WORKTREE })

    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull()
    expect(screen.getByTitle('/etc/hosts')).toHaveTextContent('hosts')
  })

  it('shows the display diff as text for edits recorded without a patch', () => {
    renderEdit({ details: { diff: '-10 const old = 3\n+10 const next = 3' } })

    expect(screen.queryByTestId('patch-diff')).toBeNull()
    expect(screen.getByLabelText('Edit diff')).toHaveTextContent('+10 const next = 3')
  })

  it('falls back to text inside the row when the diff cannot render', async () => {
    // React reports the caught render error; the row's boundary handles it.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    renderEdit({ details: { patch: `${EDIT_PATCH}${UNRENDERABLE_MARKER}` } })

    expect(await screen.findByLabelText('Edit diff')).toHaveTextContent('+const next = 3')
    expect(screen.queryByTestId('patch-diff')).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy diff' })).toBeInTheDocument()
  })

  it('keeps arguments and the error for a failed edit', () => {
    render(
      <ToolCallBlock
        name="edit"
        args={editArgs('src/geo.ts')}
        state="complete"
        result={{ content: 'Could not find the exact text in src/geo.ts.', state: 'error' }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /src\/geo\.ts/ }))

    expect(screen.getByText('Arguments')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not find the exact text')
    expect(screen.queryByRole('button', { name: 'Copy diff' })).toBeNull()
  })
})
