/**
 * Counts o200k tokens, the tokenizer the first-turn prefix budget and the memory caps use.
 *
 *   bun run tokens:count <file...>
 *   printf '%s' "<text>" | bun run tokens:count
 *
 * Prints one `<tokens> <file>` line per file and a total line when there is more than one.
 * Use it to price text that every turn loads: AGENTS.md, MEMORY.md, skill descriptions and rules.
 */
import { readFileSync } from 'node:fs'
import { countO200kTokens } from './perf/first-turn-prefix/prefix-tokens'

const SCRIPT_ARGUMENTS_START = 2
const STDIN_FILE_DESCRIPTOR = 0

const files = process.argv.slice(SCRIPT_ARGUMENTS_START)
if (files.length === 0) {
  console.log(countO200kTokens(readFileSync(STDIN_FILE_DESCRIPTOR, 'utf8')))
} else {
  let total = 0
  for (const file of files) {
    const tokens = countO200kTokens(readFileSync(file, 'utf8'))
    total += tokens
    console.log(`${tokens} ${file}`)
  }
  if (files.length > 1) console.log(`${total} total`)
}
