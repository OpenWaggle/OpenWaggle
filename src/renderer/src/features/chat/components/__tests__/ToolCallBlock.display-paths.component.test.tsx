import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ChatDisplayPathProvider } from '../ChatDisplayPathContext'
import { ToolCallBlock } from '../ToolCallBlock'

vi.mock('@pierre/diffs/react', () => ({
  PatchDiff: ({ patch }: { readonly patch: string }) => (
    <div data-testid="diffs-container">
      <pre data-testid="patch-diff">{patch}</pre>
    </div>
  ),
  useWorkerPool: () => undefined,
  WorkerPoolContextProvider: ({ children }: { readonly children: ReactNode }) => children,
}))

describe('ToolCallBlock display paths', () => {
  it('preserves exact source lines when a unified diff contains the worktree path', async () => {
    const worktreePath = '/Users/diego/.openwaggle/worktrees/OpenWaggle/session-1'
    const removedLine = `-const skill = '${worktreePath}/.agents/skills/review/SKILL.md'`
    const addedLine = `+const skill = '${worktreePath}/.agents/skills/code-review/SKILL.md'`

    render(
      <ChatDisplayPathProvider projectPath="/Users/diego/OpenWaggle" worktreePath={worktreePath}>
        <ToolCallBlock
          name="edit"
          args='{"path":"src/app.ts"}'
          state="complete"
          result={{
            content: {
              content: [{ type: 'text', text: 'Successfully replaced 1 block(s).' }],
              details: {
                diff: `--- ${worktreePath}/src/app.ts\n+++ ${worktreePath}/src/app.ts\n@@ -1 +1 @@\n${removedLine}\n${addedLine}`,
                firstChangedLine: 1,
              },
            },
            state: 'complete',
          }}
        />
      </ChatDisplayPathProvider>,
    )

    const patch = await screen.findByTestId('patch-diff', undefined, { timeout: 10_000 })
    expect(patch.textContent?.split('\n')).toEqual(
      expect.arrayContaining([removedLine, addedLine, '--- src/app.ts', '+++ src/app.ts']),
    )
  })

  it('preserves exact source returned by read when it contains the worktree path', () => {
    const worktreePath = '/Users/diego/.openwaggle/worktrees/OpenWaggle/session-1'
    const sourceLine = `const skill = '${worktreePath}/.agents/skills/code-review/SKILL.md'`
    const { container } = render(
      <ChatDisplayPathProvider projectPath="/Users/diego/OpenWaggle" worktreePath={worktreePath}>
        <ToolCallBlock
          name="read"
          args='{"path":"src/app.ts"}'
          state="complete"
          result={{ content: sourceLine, state: 'complete' }}
        />
      </ChatDisplayPathProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Read src\/app\.ts/ }))
    expect(
      [...container.querySelectorAll('code')].some((node) =>
        node.textContent?.includes(sourceLine),
      ),
    ).toBe(true)
  })
})
