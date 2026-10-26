/**
 * Component tests run under Vitest's default deadlines (10 s per hook, 5 s per test). A dynamic
 * import of a large module graph is cold the first time a file runs it, and under a loaded machine
 * that alone took about 10 s: `useWorkspaceLifecycle.component.test.tsx` failed its first test
 * with "Hook timed out in 10000ms" on main. The import belongs in a `beforeAll` with an explicit
 * deadline, which the file pays for once; per-test hooks stay cheap resets.
 *
 * This finds the two shapes that bring it back: a dynamic import (`import(...)`, or a test harness
 * loader `loadX()`) in a `beforeEach`, and one in a `beforeAll` without a deadline argument.
 */

export interface ColdImportHookFinding {
  readonly file: string
  readonly line: number
  readonly reason: 'beforeEach' | 'beforeAll-without-timeout'
}

const HOOK_CALL = /\b(beforeEach|beforeAll)\(/gu
const DYNAMIC_IMPORT = /\bimport\(|\bawait\s+load[A-Z]\w*\(/u
/** A trailing `, <deadline>` argument after the hook's function. */
const TIMEOUT_ARGUMENT = /\}\s*,\s*[\w.]+\s*$/u

/** The text between the call's parentheses, or null when they never balance. */
function callArguments(source: string, openParenthesis: number) {
  let depth = 1
  let index = openParenthesis + 1
  while (index < source.length && depth > 0) {
    const character = source[index]
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    index += 1
  }
  return depth === 0 ? source.slice(openParenthesis + 1, index - 1) : null
}

function lineOf(source: string, index: number) {
  return source.slice(0, index).split('\n').length
}

export function coldImportHookFindings(file: string, source: string): ColdImportHookFinding[] {
  const findings: ColdImportHookFinding[] = []
  for (const match of source.matchAll(HOOK_CALL)) {
    const openParenthesis = match.index + match[0].length - 1
    const body = callArguments(source, openParenthesis)
    if (body === null || !DYNAMIC_IMPORT.test(body)) continue
    const line = lineOf(source, match.index)
    if (match[1] === 'beforeEach') {
      findings.push({ file, line, reason: 'beforeEach' })
      continue
    }
    if (!TIMEOUT_ARGUMENT.test(body.trimEnd())) {
      findings.push({ file, line, reason: 'beforeAll-without-timeout' })
    }
  }
  return findings
}
