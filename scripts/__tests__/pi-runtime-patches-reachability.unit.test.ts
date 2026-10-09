import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PATCHES_DIRECTORY = path.join(import.meta.dirname, '..', '..', 'patches')
const RETURN_STATEMENT = /^(\s*)return\b.*;\s*$/
/** What may follow a `return` at the same indentation and still be reachable. */
const REACHABLE_AFTER_RETURN = /^\s*(case\b|default\b|\})/

function indentationOf(line: string) {
  return /^\s*/.exec(line)?.[0] ?? ''
}

/**
 * Statements that follow a `return` in the same block of a patched file. Each hunk is read as it
 * leaves the file, context lines included, so a hunk that adds a `return` above an original one
 * shows the original as unreachable.
 */
function unreachableAfterReturn(patch: string) {
  const found: string[] = []
  let file = ''
  let lines: string[] = []
  const check = () => {
    lines.forEach((line, index) => {
      const next = lines[index + 1]
      const returned = RETURN_STATEMENT.exec(line)
      if (!returned || next === undefined || next.trim() === '') return
      if (indentationOf(next) !== returned[1] || REACHABLE_AFTER_RETURN.test(next)) return
      found.push(`${file}: ${next.trim()}`)
    })
    lines = []
  }
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.slice(4).trim()
      continue
    }
    if (line.startsWith('@@')) {
      check()
      continue
    }
    // A hunk's post-image: its added and context lines, never the removed ones.
    if (line.startsWith('+') || line.startsWith(' ')) lines.push(line.slice(1))
  }
  check()
  return found
}

describe('Pi runtime patches', () => {
  const patches = readdirSync(PATCHES_DIRECTORY).filter(
    (name) => name.startsWith('@earendil-works__') && name.endsWith('.patch'),
  )

  it('are found', () => {
    expect(patches.length).toBeGreaterThan(0)
  })

  it.each(patches)('%s leaves no statement unreachable after a return', (name) => {
    expect(unreachableAfterReturn(readFileSync(path.join(PATCHES_DIRECTORY, name), 'utf8'))).toEqual(
      [],
    )
  })

  it('reports a hunk that adds a return above the original one', () => {
    const patch = [
      '+++ b/dist/core/example.js',
      '@@ -1,3 +1,4 @@',
      ' export function build() {',
      '+    return { value, extra };',
      '     return { value };',
      ' }',
    ].join('\n')

    expect(unreachableAfterReturn(patch)).toEqual(['b/dist/core/example.js: return { value };'])
  })
})
