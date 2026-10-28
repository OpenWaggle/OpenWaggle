/**
 * o200k tokens of each benchmarked agent's first model request, from the proxy log slices
 * (`results/<agent>.proxy.jsonl`): the system prompt and the tool declarations, whatever wire
 * format the agent used (OpenAI chat completions, OpenAI responses or Anthropic messages).
 * Writes `results/request-tokens.json`, which parse-results.py merges into results.json.
 *
 *   tsx scripts/benchmark-docker/count-request-tokens.ts scripts/benchmark-docker/results
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { firstRequestOf, requestTokens } from './request-tokens'

const PROXY_SLICE_SUFFIX = '.proxy.jsonl'
const JSON_INDENT = 2
const RESULTS_ARGUMENT = 2

async function firstRequest(file: string) {
  return firstRequestOf((await readFile(file, 'utf8')).split('\n'))
}

async function main() {
  const results = path.resolve(process.argv[RESULTS_ARGUMENT] ?? path.join(import.meta.dirname, 'results'))
  const slices = (await readdir(results)).filter((name) => name.endsWith(PROXY_SLICE_SUFFIX))
  const counts: Record<string, ReturnType<typeof requestTokens>> = {}
  for (const slice of slices) {
    const request = await firstRequest(path.join(results, slice))
    if (request) counts[slice.slice(0, -PROXY_SLICE_SUFFIX.length)] = requestTokens(request)
  }
  await writeFile(path.join(results, 'request-tokens.json'), `${JSON.stringify(counts, null, JSON_INDENT)}\n`)
  process.stdout.write(`${JSON.stringify(counts, null, JSON_INDENT)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exitCode = 1
})
