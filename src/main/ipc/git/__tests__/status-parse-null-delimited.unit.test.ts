import { describe, expect, it } from 'vitest'
import { buildChangedFiles, parseNumstat, parsePorcelain } from '../status-parse'

const CONTROL_CHARACTER_PATHS = ['line\nbreak.txt', 'tab\tname.txt', 'back\\slash.txt'] as const

describe('NUL-delimited Git status parsing', () => {
  it('preserves control characters and backslashes in porcelain paths', () => {
    const porcelain = CONTROL_CHARACTER_PATHS.map((filePath) => ` M ${filePath}\0`).join('')

    expect(parsePorcelain(porcelain).map((entry) => entry.path)).toEqual(CONTROL_CHARACTER_PATHS)
  })

  it('reads both exact paths from a NUL-delimited rename', () => {
    const target = 'new\tname\\file.txt'
    const source = 'old\nname\\file.txt'

    expect(parsePorcelain(`R  ${target}\0${source}\0`)).toEqual([
      {
        path: target,
        status: 'renamed',
        staged: true,
        unstaged: false,
        renamedFrom: source,
      },
    ])
  })

  it('matches NUL-delimited numstat records to their exact paths', () => {
    const [newlinePath, tabPath, backslashPath] = CONTROL_CHARACTER_PATHS
    const porcelain = parsePorcelain(
      CONTROL_CHARACTER_PATHS.map((filePath) => ` M ${filePath}\0`).join(''),
    )
    const numstat = parseNumstat(
      `2\t1\t${newlinePath}\0` + `3\t2\t${tabPath}\0` + `4\t3\t${backslashPath}\0`,
    )

    expect(buildChangedFiles(porcelain, numstat)).toEqual([
      {
        path: backslashPath,
        status: 'modified',
        staged: false,
        unstaged: true,
        additions: 4,
        deletions: 3,
      },
      {
        path: newlinePath,
        status: 'modified',
        staged: false,
        unstaged: true,
        additions: 2,
        deletions: 1,
      },
      {
        path: tabPath,
        status: 'modified',
        staged: false,
        unstaged: true,
        additions: 3,
        deletions: 2,
      },
    ])
  })

  it('uses the destination record for a NUL-delimited rename numstat', () => {
    const source = 'old\nname.txt'
    const target = 'new\tname.txt'

    expect(parseNumstat(`5\t2\t\0${source}\0${target}\0`)).toEqual(
      new Map([[target, { additions: 5, deletions: 2 }]]),
    )
  })
})
