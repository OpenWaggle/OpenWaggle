import process from 'node:process'
import { evaluateReactCompilerGate, reactCompilerBailouts } from './react-compiler-coverage'

/**
 * Fails when a component or hook on the chat or composer surface stops compiling with the React
 * Compiler. The build cannot catch this: it runs the compiler with `panicThreshold: 'none'`.
 */
const CHECKED_ROOTS = ['src/renderer/src/features/chat', 'src/renderer/src/features/composer']

/**
 * Files that are known to bail out, with how many functions do. The list may only shrink: a file
 * that compiles again must be removed, and no file may be added.
 */
const KNOWN_BAILOUTS: Readonly<Record<string, number>> = {}

const bailouts = reactCompilerBailouts(process.cwd(), CHECKED_ROOTS)
const { unexpected, stale } = evaluateReactCompilerGate(bailouts, KNOWN_BAILOUTS)

for (const bailout of unexpected) {
  console.error(
    `${bailout.file}:${String(bailout.line ?? '?')} ${bailout.kind}: ${bailout.reason}`,
  )
}
for (const file of stale) {
  console.error(`${file} now has fewer React Compiler bailouts; lower or remove its allowlist entry.`)
}
if (unexpected.length > 0 || stale.length > 0) {
  console.error(
    'React Compiler bailouts on the chat/composer surface run uncompiled on every streamed token. ' +
      'Fix the reported functions (ref reads during render, try/finally without catch, …).',
  )
  process.exitCode = 1
} else {
  console.log(`React Compiler: ${CHECKED_ROOTS.join(', ')} compile without bailouts.`)
}
