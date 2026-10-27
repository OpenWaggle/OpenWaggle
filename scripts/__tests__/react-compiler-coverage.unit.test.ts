import { describe, expect, it } from 'vitest'
import {
  compileWithReactCompiler,
  evaluateReactCompilerGate,
  reactCompilerBailoutsForSource,
} from '../react-compiler-coverage'

const MEMO_CACHE = 'react/compiler-runtime'

describe('React Compiler as the app build runs it', () => {
  it('compiles a component that destructures its props with a default value', () => {
    // Babel 8 reports AssignmentPattern as no LVal; unpatched, the compiler 1.0.0 bailed out of
    // every component and hook with a defaulted destructure, and the build kept them uncompiled.
    const output = compileWithReactCompiler(
      'export function Row({ label, muted = false }) { return <div>{label}{String(muted)}</div> }',
      'Row.tsx',
    )

    expect(output.bailouts).toEqual([])
    expect(output.code).toContain(MEMO_CACHE)
    expect(output.code).toMatch(/=== undefined \? false :/u)
  })

  it('compiles a defaulted destructure inside a component body', () => {
    const output = compileWithReactCompiler(
      'export function Row(props) { const { label, count = 1 } = props; return <b>{label}{count}</b> }',
      'Row.tsx',
    )

    expect(output.bailouts).toEqual([])
    expect(output.code).toContain(MEMO_CACHE)
  })

  it('reports a component that reads a ref during render', () => {
    const bailouts = reactCompilerBailoutsForSource(
      [
        "import { useRef } from 'react'",
        'export function Panel() { const ref = useRef(0); return <div>{ref.current}</div> }',
      ].join('\n'),
      'Panel.tsx',
    )

    expect(bailouts.map((bailout) => bailout.reason)).toEqual([
      expect.stringContaining('Cannot access refs during render'),
    ])
  })
})

describe('evaluateReactCompilerGate', () => {
  const bailout = (file: string) => ({ file, line: 1, kind: 'CompileError', reason: 'r' })

  it('fails a bailout in a file that is not allowlisted', () => {
    expect(evaluateReactCompilerGate([bailout('a.ts')], {}).unexpected).toHaveLength(1)
  })

  it('allows listed bailouts and asks for the list to shrink once they are fixed', () => {
    expect(evaluateReactCompilerGate([bailout('a.ts')], { 'a.ts': 1 })).toEqual({
      unexpected: [],
      stale: [],
    })
    expect(evaluateReactCompilerGate([], { 'a.ts': 1 }).stale).toEqual(['a.ts'])
  })
})
