import type { GitFileDiff } from '@shared/types/git'
import { describe, expect, it } from 'vitest'
import { buildNavigatorTree, fileChangeStats, NAVIGATOR_ROOT_ID } from '../navigator-tree'

function file(path: string, diff = '@@ -1 +1 @@\n-a\n+b', additions = 1, deletions = 1) {
  return { path, diff, additions, deletions } satisfies GitFileDiff
}

describe('navigator tree', () => {
  it('groups files into directories', () => {
    const tree = buildNavigatorTree([
      file('src/app.ts'),
      file('src/components/Button.tsx'),
      file('README.md'),
    ])

    expect(tree.childrenByPath.get(NAVIGATOR_ROOT_ID)).toEqual(['src', 'README.md'])
    expect(tree.childrenByPath.get('src')).toEqual(['src/components', 'src/app.ts'])
    expect(tree.childrenByPath.get('src/components')).toEqual(['src/components/Button.tsx'])
    expect(tree.nodes.get('src')?.isFile).toBe(false)
    expect(tree.nodes.get('src/app.ts')?.isFile).toBe(true)
    expect(tree.nodes.get('src/components/Button.tsx')?.name).toBe('Button.tsx')
  })

  it('puts directories before files and sorts each group', () => {
    const tree = buildNavigatorTree([
      file('z.ts'),
      file('a.ts'),
      file('lib/b.ts'),
      file('api/c.ts'),
    ])

    expect(tree.childrenByPath.get(NAVIGATOR_ROOT_ID)).toEqual(['api', 'lib', 'a.ts', 'z.ts'])
  })

  it('attaches change stats to files only', () => {
    const tree = buildNavigatorTree([file('src/app.ts', '@@ -1 +1 @@\n-a\n+b', 4, 2)])

    expect(tree.nodes.get('src/app.ts')?.stats).toEqual({
      status: 'modified',
      additions: 4,
      deletions: 2,
    })
    expect(tree.nodes.get('src')?.stats).toBeUndefined()
  })

  it('derives status from the patch mode header, not the line counts', () => {
    expect(
      fileChangeStats(
        file('a.ts', 'diff --git a/a.ts b/a.ts\nnew file mode 100644\n@@ -0,0 +1 @@\n+x'),
      ),
    ).toMatchObject({ status: 'added' })
    expect(
      fileChangeStats(
        file('b.ts', 'diff --git a/b.ts b/b.ts\ndeleted file mode 100644\n@@ -1 +0,0 @@\n-x'),
      ),
    ).toMatchObject({ status: 'deleted' })
    expect(fileChangeStats(file('c.ts'))).toMatchObject({ status: 'modified' })
  })

  it('does not duplicate shared directories', () => {
    const tree = buildNavigatorTree([file('src/a.ts'), file('src/b.ts')])

    expect(tree.childrenByPath.get(NAVIGATOR_ROOT_ID)).toEqual(['src'])
    expect(tree.childrenByPath.get('src')).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('handles an empty file list', () => {
    const tree = buildNavigatorTree([])
    expect(tree.nodes.size).toBe(0)
    expect(tree.childrenByPath.get(NAVIGATOR_ROOT_ID)).toBeUndefined()
  })
})
