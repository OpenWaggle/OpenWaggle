import { describe, expect, it } from 'vitest'
import { formatDisplayPath, formatDisplayPathsInText } from '../display-path'

const PROJECT_ROOT = '/Users/diego/Projects/OpenWaggle'
const WORKTREE_ROOT =
  '/Users/diego/.openwaggle/worktrees/OpenWaggle/01a04310-e5ba-72e4-847b-e12c7e355555'

describe('formatDisplayPath', () => {
  it('shows files relative to the active project', () => {
    expect(formatDisplayPath(`${PROJECT_ROOT}/src/main.ts`, [PROJECT_ROOT])).toBe('src/main.ts')
  })

  it('shows files relative to the active session worktree', () => {
    expect(
      formatDisplayPath(`${WORKTREE_ROOT}/.agents/skills/grill-me/SKILL.md`, [
        WORKTREE_ROOT,
        PROJECT_ROOT,
      ]),
    ).toBe('.agents/skills/grill-me/SKILL.md')
  })

  it('uses the most specific matching root', () => {
    expect(
      formatDisplayPath('/repo/packages/app/src/index.ts', ['/repo', '/repo/packages/app']),
    ).toBe('src/index.ts')
  })

  it('supports Windows paths without exposing the checkout root', () => {
    expect(
      formatDisplayPath('C:\\Users\\diego\\Projects\\OpenWaggle\\src\\main.ts', [
        'C:\\Users\\diego\\Projects\\OpenWaggle',
      ]),
    ).toBe('src/main.ts')
  })

  it('leaves already-relative and unrelated paths unchanged', () => {
    expect(formatDisplayPath('.agents/skills/review/SKILL.md', [PROJECT_ROOT])).toBe(
      '.agents/skills/review/SKILL.md',
    )
    expect(formatDisplayPath('/opt/external/tool.json', [PROJECT_ROOT])).toBe(
      '/opt/external/tool.json',
    )
  })

  it('represents the root itself without exposing it', () => {
    expect(formatDisplayPath(PROJECT_ROOT, [PROJECT_ROOT])).toBe('.')
  })

  it('recognizes OpenWaggle Session worktrees without an explicitly supplied root', () => {
    expect(formatDisplayPath(`${WORKTREE_ROOT}/src/main.ts`, [])).toBe('src/main.ts')
    expect(formatDisplayPath(WORKTREE_ROOT, [])).toBe('.')
  })
})

describe('formatDisplayPathsInText', () => {
  it('shortens every active project and worktree path embedded in text', () => {
    const text = [
      `Read ${WORKTREE_ROOT}/.agents/skills/grill-me/SKILL.md`,
      `Then update ${PROJECT_ROOT}/docs/agents/design.md.`,
    ].join('\n')

    expect(formatDisplayPathsInText(text, [WORKTREE_ROOT, PROJECT_ROOT])).toBe(
      ['Read .agents/skills/grill-me/SKILL.md', 'Then update docs/agents/design.md.'].join('\n'),
    )
  })

  it('does not alter a path that only shares the root prefix', () => {
    expect(formatDisplayPathsInText(`${PROJECT_ROOT}-copy/file.ts`, [PROJECT_ROOT])).toBe(
      `${PROJECT_ROOT}-copy/file.ts`,
    )
  })

  it('does not rewrite a project-root suffix embedded in another path or URL', () => {
    const root = '/repo'
    const text = 'See /archive/repo/file and https://host/repo/file'

    expect(formatDisplayPathsInText(text, [root])).toBe(text)
  })

  it('still rewrites a project path after a human-readable label', () => {
    expect(formatDisplayPathsInText('Path: /repo/src/main.ts', ['/repo'])).toBe('Path: src/main.ts')
  })

  it('preserves unrelated backslashes in displayed command output', () => {
    const text = `regex \\d+ then C:\\Users\\diego\\Projects\\OpenWaggle\\src\\main.ts`
    expect(formatDisplayPathsInText(text, ['C:\\Users\\diego\\Projects\\OpenWaggle'])).toBe(
      'regex \\d+ then src\\main.ts',
    )
  })

  it('removes OpenWaggle Session worktree storage prefixes from unscoped UI text', () => {
    expect(formatDisplayPathsInText(`Could not read ${WORKTREE_ROOT}/src/main.ts`, [])).toBe(
      'Could not read src/main.ts',
    )
    expect(formatDisplayPathsInText(`Working directory: ${WORKTREE_ROOT}`, [])).toBe(
      'Working directory: .',
    )
  })
})
