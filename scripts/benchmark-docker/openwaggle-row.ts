/**
 * The OpenWaggle row of the first-turn token benchmark: the packaged app itself on the host, in
 * hidden automation with its first-party extensions, sending the benchmark prompt through the
 * benchmark's logging proxy with the same model as the containerized agents (see run.sh).
 *
 *   tsx scripts/benchmark-docker/openwaggle-row.ts --app <OpenWaggle.app> \
 *     --proxy http://127.0.0.1:8399 --model z-ai/glm-5.3-flash
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { startCliRun } from '../perf/lib/cli-run'
import { resolvePerfApp, stopProcessGroup } from '../perf/lib/perf-app'
import { delay, withRunningApp } from '../perf/lib/running-app'

const PROBE = 'Reply with exactly OK and nothing else.'
const PROVIDER = 'bench'
const CONTEXT_WINDOW = 1_000_000
const MAX_TOKENS = 131_072
const TIMEOUT_MS = 120_000
const JSON_INDENT = 2
const USAGE_EXIT_CODE = 2

const { values } = parseArgs({
  options: { app: { type: 'string' }, proxy: { type: 'string' }, model: { type: 'string' } },
})

async function configureBenchProvider(agentDir: string, proxy: string, model: string) {
  await mkdir(agentDir, { recursive: true })
  const models = {
    providers: {
      [PROVIDER]: {
        name: 'Bench OpenRouter',
        baseUrl: `${proxy}/api/v1`,
        api: 'openai-completions',
        apiKey: 'bench-proxy',
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
  const { proxy, model } = { proxy: values.proxy, model: values.model }
  const exit = await withRunningApp(
    app,
    {
      mode: 'cold',
      sessionListText: null,
      timeoutMs: TIMEOUT_MS,
      warmHostIdleMs: 0,
      prepareProfile: (profile) => configureBenchProvider(profile.agentDir, proxy, model),
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

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exitCode = 1
})
