import type { ActionRun } from '@shared/types/action-runs'
import { render, screen } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { ActionRunHeading } from '../ActionRunHeading'

const workspacePath =
  '/Users/diego/.openwaggle/worktrees/project/9a9b9c9d-1000-4000-8000-9a9b9c9d9e9f'

describe('ActionRunHeading', () => {
  it('shows a Session-relative working directory without exposing worktree storage', () => {
    const run = fromPartial<ActionRun>({
      projectPath: '/Users/diego/Projects/project',
      workspacePath,
      action: { name: 'Build' },
      invocation: { type: 'command', command: 'pnpm build', cwd: workspacePath },
      status: 'running',
      ready: false,
      exitCode: null,
    })

    const { container } = render(<ActionRunHeading run={run} error={null} />)

    expect(screen.getByText('Working directory: .')).toBeInTheDocument()
    expect(container.textContent).not.toContain('/Users/diego')
    expect(container.textContent).not.toContain('.openwaggle/worktrees')
  })

  it('shows the invocation directory beneath the Session worktree', () => {
    const run = fromPartial<ActionRun>({
      projectPath: '/Users/diego/Projects/project',
      workspacePath,
      action: { name: 'Build' },
      invocation: {
        type: 'command',
        command: 'pnpm build',
        cwd: `${workspacePath}/packages/web`,
      },
      status: 'running',
      ready: false,
      exitCode: null,
    })

    const { container } = render(<ActionRunHeading run={run} error={null} />)

    expect(screen.getByText('Working directory: packages/web')).toBeInTheDocument()
    expect(container.textContent).not.toContain(workspacePath)
  })
})
