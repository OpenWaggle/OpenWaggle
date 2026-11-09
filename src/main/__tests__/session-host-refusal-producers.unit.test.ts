import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { SESSION_HOST_ERROR_KINDS } from '@shared/domain/session-host-refusals'
import { describe, expect, it } from 'vitest'

/** Lines after an error frame's `kind: 'error'` that must name its error kind. */
const FRAME_WINDOW_LINES = 8
/** Fewer rejected-outcome literals than this means the scan stopped finding them. */
const MINIMUM_KNOWN_PRODUCERS = 30
const HAND_WRITTEN_KIND = new RegExp(`^\\s*kind: '(${SESSION_HOST_ERROR_KINDS.join('|')})',?$`)

function sourceFiles(...roots: readonly string[]) {
  return roots.flatMap((root) =>
    readdirSync(root, { recursive: true, encoding: 'utf8' })
      .map((file) => path.join(root, file))
      .filter(
        (file) => file.endsWith('.ts') && !file.includes('__tests__') && !file.includes('.test.'),
      ),
  )
}

/** The text of the innermost object literal around `offset`, from its `{` to its `}`. */
function enclosingObject(source: string, offset: number) {
  let depth = 0
  let start = offset
  for (; start >= 0; start -= 1) {
    if (source[start] === '}') depth += 1
    if (source[start] === '{') {
      if (depth === 0) break
      depth -= 1
    }
  }
  depth = 0
  let end = offset
  for (; end < source.length; end += 1) {
    if (source[end] === '{') depth += 1
    if (source[end] === '}') {
      if (depth === 0) break
      depth -= 1
    }
  }
  return source.slice(start, end + 1)
}

/** Offsets of the lines matching `pattern`, with their 1-based line numbers. */
function matchingLines(source: string, pattern: (line: string) => boolean) {
  let offset = 0
  return source.split('\n').flatMap((line, index) => {
    const at = offset
    offset += line.length + 1
    return pattern(line) ? [{ line: index + 1, offset: at + line.length - 1 }] : []
  })
}

/** Rejected-outcome object literals: `effect: 'rejected'` that is not a type or comparison. */
function rejectedOutcomeLiterals(file: string) {
  const source = readFileSync(file, 'utf8')
  return matchingLines(
    source,
    (line) => /(?<!readonly )effect: 'rejected'/.test(line) && !/[!=]==/.test(line),
  ).map(({ line, offset }) => ({ line, object: enclosingObject(source, offset) }))
}

/** Refusal objects, outcomes or query errors, that write their `kind` by hand beside a `code`. */
function handWrittenKinds(file: string) {
  const source = readFileSync(file, 'utf8')
  return matchingLines(source, (line) => HAND_WRITTEN_KIND.test(line))
    .filter(({ offset }) => /\bcode:/.test(enclosingObject(source, offset)))
    .map(({ line }) => `${file}:${String(line)}`)
}

describe('Session Host refusal producers (ADR 0063)', () => {
  it('builds every rejected outcome through the refusal table', () => {
    const literals = sourceFiles('src/main', 'src/shared').flatMap((file) =>
      rejectedOutcomeLiterals(file).map((literal) => ({ ...literal, file })),
    )
    const unkinded = literals
      .filter(({ object }) => !object.includes('sessionHostRefusal('))
      .map(({ file, line }) => `${file}:${line}`)

    // The scan must see the producers it guards, or it would pass on nothing.
    expect(literals.length).toBeGreaterThan(MINIMUM_KNOWN_PRODUCERS)
    expect(unkinded).toEqual([])
  })

  it('never writes a refusal kind by hand, where it could disagree with the table', () => {
    expect(sourceFiles('src/main', 'src/shared').flatMap(handWrittenKinds)).toEqual([])
  })

  it('names the kind of every error frame the Session Host sends', () => {
    const unkinded = sourceFiles('src/main/session-host').flatMap((file) => {
      const lines = readFileSync(file, 'utf8').split('\n')
      return lines.flatMap((line, index) => {
        if (!/kind: 'error',?/.test(line) || /[!=]==/.test(line)) return []
        const frame = lines.slice(index, index + FRAME_WINDOW_LINES).join('\n')
        return frame.includes('errorKind') || frame.includes('localSessionErrorFrameCode(')
          ? []
          : [`${file}:${index + 1}`]
      })
    })

    expect(unkinded).toEqual([])
  })
})
