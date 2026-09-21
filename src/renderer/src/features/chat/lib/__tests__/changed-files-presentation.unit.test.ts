import type { TurnDiffFileSummary } from '@shared/types/turn-diff'
import { describe, expect, it } from 'vitest'
import {
  buildTurnDiffTree,
  CHANGED_FILES_AUTO_EXPAND_FILE_LIMIT,
  CHANGED_FILES_AUTO_EXPAND_LINE_LIMIT,
  changedFileName,
  selectChangedFilePreview,
  shouldAutoExpandChangedFiles,
  summarizeChangedFileScopes,
  summarizeTurnDiffStats,
} from '../changed-files-presentation'

function file(path: string, additions = 10, deletions = 2): TurnDiffFileSummary {
  return { path, additions, deletions }
}

describe('changed-files-presentation', () => {
  it('auto-expands only the latest turn within the file and line limits', () => {
    const small = [file('src/a.ts', 50), file('src/b.ts', 60)]
    expect(shouldAutoExpandChangedFiles(small, true)).toBe(true)
    expect(shouldAutoExpandChangedFiles(small, false)).toBe(false)
    expect(shouldAutoExpandChangedFiles(small, true)).toBe(true)

    const tooManyFiles = Array.from({ length: CHANGED_FILES_AUTO_EXPAND_FILE_LIMIT + 1 }, (_, i) =>
      file(`src/f${String(i)}.ts`),
    )
    expect(shouldAutoExpandChangedFiles(tooManyFiles, true)).toBe(false)

    const tooManyLines = [file('src/big.ts', CHANGED_FILES_AUTO_EXPAND_LINE_LIMIT, 1)]
    expect(shouldAutoExpandChangedFiles(tooManyLines, true)).toBe(false)
  })

  it('summarizes top-level directory scopes with counts', () => {
    const files = [
      file('src/a.ts'),
      file('src/b.ts'),
      file('src/deep/c.ts'),
      file('docs/readme.md'),
      file('root-file.txt'),
    ]

    const scopes = summarizeChangedFileScopes(files)

    expect(scopes).toEqual([
      { label: 'src', fileCount: 3 },
      { label: 'docs', fileCount: 1 },
      { label: 'root', fileCount: 1 },
    ])
  })

  it('previews one file per scope before filling with remaining files', () => {
    const files = [
      file('src/a.ts'),
      file('src/b.ts'),
      file('docs/readme.md'),
      file('docs/setup.md'),
    ]

    const preview = selectChangedFilePreview(files)

    expect(preview.map((entry) => entry.path)).toEqual(['src/a.ts', 'docs/readme.md', 'src/b.ts'])
  })

  it('names files by their last path segment', () => {
    expect(changedFileName('src/deep/nested/widget.tsx')).toBe('widget.tsx')
    expect(changedFileName('README.md')).toBe('README.md')
  })

  it('collapses an empty file list to an empty summary and preview', () => {
    expect(shouldAutoExpandChangedFiles([], true)).toBe(true)
    expect(selectChangedFilePreview([])).toEqual([])
    expect(summarizeChangedFileScopes([])).toEqual([])
  })

  it('collapses turns at exactly the auto-expand limits', () => {
    const atFileLimit = Array.from({ length: CHANGED_FILES_AUTO_EXPAND_FILE_LIMIT }, (_, i) =>
      file(`src/f${String(i)}.ts`, 1),
    )
    expect(shouldAutoExpandChangedFiles(atFileLimit, true)).toBe(true)
    expect(shouldAutoExpandChangedFiles([...atFileLimit, file('src/extra.ts', 1)], true)).toBe(
      false,
    )
  })

  it('builds a directory tree with per-directory aggregated stats', () => {
    const tree = buildTurnDiffTree([
      file('src/app/deep/one.ts', 3, 1),
      file('src/app/two.ts', 5, 0),
      file('src/root.ts', 1, 2),
      file('readme.md', 0, 0),
    ])

    expect(tree.map((node) => node.name)).toEqual(['src', 'readme.md'])
    const src = tree[0]
    expect(src?.kind).toBe('directory')
    if (src?.kind !== 'directory') return
    expect(src.stat).toEqual({ additions: 9, deletions: 3 })
    expect(src.children.map((child) => child.name)).toEqual(['app', 'root.ts'])
    const app = src.children[0]
    expect(app?.kind).toBe('directory')
    if (app?.kind !== 'directory') return
    expect(app.name).toBe('app')
    expect(app.stat).toEqual({ additions: 8, deletions: 1 })
    expect(app.children.map((child) => child.name)).toEqual(['deep', 'two.ts'])
  })

  it('sorts directories before files with deterministic ordering', () => {
    const tree = buildTurnDiffTree([file('b/zed.ts'), file('a/yak.ts'), file('m.ts')])
    expect(tree.map((node) => node.name)).toEqual(['a', 'b', 'm.ts'])
  })

  it('summarizes total stats across all files', () => {
    expect(summarizeTurnDiffStats([file('a.ts', 3, 1), file('b.ts', 2, 4)])).toEqual({
      additions: 5,
      deletions: 5,
    })
  })
})
