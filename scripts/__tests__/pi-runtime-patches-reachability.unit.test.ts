import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = path.join(import.meta.dirname, '..', '..')
const PATCHES_DIRECTORY = path.join(REPOSITORY_ROOT, 'patches')
const TYPESCRIPT_COMPILER = path.join(REPOSITORY_ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
const UNREACHABLE_CODE_DIAGNOSTIC = /^(.+)\((\d+),\d+\): error TS7027:/
/** A statement that leaves its block: `return`, `throw`, `break`, or `continue`. */
const RETURN_STATEMENT = /^(\s*)(return|throw|break|continue)\b.*;\s*$/
/** What may follow such a statement at the same indentation and still be reachable. */
const REACHABLE_AFTER_RETURN = /^\s*(case\b|default\b|\})/

function indentationOf(line: string) {
  return /^\s*/.exec(line)?.[0] ?? ''
}

/**
 * Statements that follow a `return`, `throw`, `break`, or `continue` in the same block of a patched file. Each hunk is read as it
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

/** The installed, patched JavaScript files a Pi patch changes. */
function patchedJavaScriptFiles(name: string) {
  const packageName = name.replace(/@[^@]+\.patch$/, '').replace('__', '/')
  return readFileSync(path.join(PATCHES_DIRECTORY, name), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('+++ b/') && line.endsWith('.js'))
    .map((line) =>
      path.join(REPOSITORY_ROOT, 'node_modules', packageName, line.slice('+++ b/'.length)),
    )
}

/**
 * TypeScript's unreachable-code check (TS7027) over JavaScript files, which also sees an exit that
 * spans several lines. Only that diagnostic is read: the files are checked without their imports.
 */
function typeScriptUnreachableCode(files: readonly string[]) {
  const result = spawnSync(
    process.execPath,
    [
      TYPESCRIPT_COMPILER,
      '--ignoreConfig',
      '--allowJs',
      '--checkJs',
      '--noEmit',
      '--noResolve',
      '--skipLibCheck',
      '--pretty',
      'false',
      '--types',
      '',
      '--allowUnreachableCode',
      'false',
      ...files,
    ],
    { encoding: 'utf8' },
  )
  return result.stdout.split('\n').flatMap((line) => {
    const match = UNREACHABLE_CODE_DIAGNOSTIC.exec(line)
    return match ? [`${path.relative(REPOSITORY_ROOT, match[1] ?? '')}:${match[2] ?? ''}`] : []
  })
}

describe('Pi runtime patches', () => {
  const patches = readdirSync(PATCHES_DIRECTORY).filter(
    (name) => name.startsWith('@earendil-works__') && name.endsWith('.patch'),
  )

  it('are found', () => {
    expect(patches.length).toBeGreaterThan(0)
  })

  it.each(patches)('%s leaves no statement unreachable after a return, throw, break, or continue', (name) => {
    expect(unreachableAfterReturn(readFileSync(path.join(PATCHES_DIRECTORY, name), 'utf8'))).toEqual(
      [],
    )
  })

  it.each(patches)('%s leaves no code TypeScript finds unreachable in the files it patches', (name) => {
    const files = patchedJavaScriptFiles(name)
    expect(files.length).toBeGreaterThan(0)
    expect(typeScriptUnreachableCode(files)).toEqual([])
  })

  it('finds a statement left after an exit that spans several lines', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'pi-patch-reachability-'))
    try {
      const file = path.join(directory, 'example.js')
      writeFileSync(file, 'export function f(a) {\n  return g(\n    a,\n  );\n  h();\n}\n')

      // tsc reports paths relative to the real working directory, which can differ from the
      // temporary directory's spelling when it sits behind a symlink (macOS /tmp).
      const reported = typeScriptUnreachableCode([file])
      expect(reported).toHaveLength(1)
      expect(reported[0]).toMatch(/(^|\/)example\.js:5$/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
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

  it.each(['throw error;', 'break;', 'continue;'])(
    'reports a statement left after %s',
    (exit) => {
      const patch = [
        '+++ b/dist/core/example.js',
        '@@ -1,4 +1,5 @@',
        ' for (const item of items) {',
        `+    ${exit}`,
        '     handle(item);',
        ' }',
      ].join('\n')

      expect(unreachableAfterReturn(patch)).toEqual(['b/dist/core/example.js: handle(item);'])
    },
  )
})

