/**
 * The OpenWaggle row of the first-turn token benchmark: the packaged app itself on the host, in
 * hidden automation with its first-party extensions, sending the benchmark prompt through the
 * benchmark's logging proxy with the same model as the containerized agents (see run.sh).
 *
 *   tsx scripts/benchmark-docker/openwaggle-row.ts --app <OpenWaggle.app> \
 *     --proxy http://127.0.0.1:8399 --model z-ai/glm-5.3-flash [--results <dir>]
 *
 * It also writes `<results>/openwaggle.app.json`, the measured build's version and commit, which
 * parse-results.py copies into results.json.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { exitWhenFlushed } from '../perf/lib/perf-results'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { startCliRun } from '../perf/lib/cli-run'
import { resolvePerfApp, stopProcessGroup } from '../perf/lib/perf-app'
import { delay, withRunningApp } from '../perf/lib/running-app'
import { readAppIdentity } from './app-identity'

const PROBE = 'Reply with exactly OK and nothing else.'
const PROVIDER = 'bench'
const CONTEXT_WINDOW = 1_000_000
const MAX_TOKENS = 131_072
const TIMEOUT_MS = 120_000
const JSON_INDENT = 2
const USAGE_EXIT_CODE = 2

const { values } = parseArgs({
  options: {
    app: { type: 'string' },
    proxy: { type: 'string' },
    model: { type: 'string' },
    results: { type: 'string', default: path.join(import.meta.dirname, 'results') },
  },
})

async function configureBenchProvider(agentDir: string, proxy: string, model: string, token: string) {
  await mkdir(agentDir, { recursive: true })
  const models = {
    providers: {
      [PROVIDER]: {
        name: 'Bench OpenRouter',
        baseUrl: `${proxy}/api/v1`,
        api: 'openai-completions',
        // The proxy's per-run token (run.sh): the proxy refuses requests without it.
        apiKey: token,
        models: [{ id: model, name: model, reasoning: true, input: ['text', 'image'], contextWindow: CONTEXT_WINDOW, maxTokens: MAX_TOKENS }],
      },
    },
  }
  await writeFile(path.join(agentDir, 'models.json'), `${JSON.stringify(models, null, JSON_INDENT)}\n`)
}

async function main() {
  if (!values.app || !values.proxy || !values.model) {
    process.stderr.write('Use --app <OpenWaggle.app> --proxy <url> --model <openrouter model>\n')
    process.exit(USAGE_EXIT_CODE)
  }
  const app = resolvePerfApp(values.app, 'openwaggle')
  const identity = await readAppIdentity(values.app)
  await mkdir(values.results, { recursive: true })
  await writeFile(path.join(values.results, 'openwaggle.app.json'), `${JSON.stringify(identity, null, JSON_INDENT)}\n`)
  const token = process.env.BENCH_PROXY_TOKEN
  if (!token) {
    process.stderr.write('Set BENCH_PROXY_TOKEN to the proxy\'s per-run token (run.sh does).\n')
    process.exit(USAGE_EXIT_CODE)
  }
  const { proxy, model } = { proxy: values.proxy, model: values.model }
  const exit = await withRunningApp(
    app,
    {
      mode: 'cold',
      sessionListText: null,
      timeoutMs: TIMEOUT_MS,
      warmHostIdleMs: 0,
      prepareProfile: (profile) => configureBenchProvider(profile.agentDir, proxy, model, token),
    },
    async ({ profile }) => {
      const run = startCliRun(app, profile, { prompt: PROBE, model: `${PROVIDER}/${model}` })
      const result = await Promise.race([run.exited, delay(TIMEOUT_MS).then(() => 'timeout' as const)])
      if (result === 'timeout') await stopProcessGroup(run.launched.child)
      process.stdout.write(`${run.launched.logLines.join('\n')}\n`)
      return result
    },
  )
  if (exit !== 0) process.exitCode = 1
}

main().then(
  () => exitWhenFlushed(typeof process.exitCode === 'number' ? process.exitCode : 0),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
    exitWhenFlushed(1)
  },
)
