/**
 * The first-turn prefix as a packaged build sends it (decision 6 of the v1 performance plan): a
 * Run started with `openwaggle run` in hidden automation, with first-party extensions on, whose
 * requests a local fake provider records. Counts o200k tokens of the system prompt (by section),
 * the tool declarations and the Run's hidden context, for every request of the Run.
 *
 *   pnpm perf:first-turn-prefix:packaged --app <OpenWaggle.app> --setup empty --out <dir>
 *   pnpm perf:first-turn-prefix:packaged --app <OpenWaggle.app> --setup maintainer --out <dir>
 *
 * `maintainer` adds the heavy-user MCP setup, this repository's AGENTS.md and project skills at the
 * baseline commit, sixteen user-global skills and a home AGENTS.md; its first request runs a short
 * `bash sleep` so the second request carries the MCP tools, as a Run's later calls do.
 */
import path from 'node:path'
import { parseArgs } from 'node:util'
import { measurePrefixTokens } from './first-turn-prefix/prefix-tokens'
import { startCliRun } from './lib/cli-run'
import { configureFakeProvider, FAKE_MODEL_REFERENCE, isTitleRequest, startFakeProvider } from './lib/fake-openai-provider'
import { createMaintainerLikeProject, writeMaintainerLikeHome } from './lib/maintainer-like-setup'
import { HEAVY_USER_MCP_ENVIRONMENT, writeHeavyUserMcpConfig } from './lib/mcp-fixtures'
import { resolvePerfApp } from './lib/perf-app'
import type { PerfProfile } from './lib/perf-profile'
import { log, measurementEnvironment, writeJsonResult } from './lib/perf-results'
import { prefixContentOfOpenAiRequest } from './lib/openai-request-prefix'
import { delay, withRunningApp } from './lib/running-app'

const PROMPT = 'Reply with exactly OK and nothing else.'
const TIMEOUT_MS = 120_000
const RUN_TIMEOUT_MS = 180_000
const MCP_SETTLE_SECONDS = 6
const USAGE_EXIT_CODE = 2
const REPOSITORY = path.resolve(import.meta.dirname, '..', '..')

const { values } = parseArgs({
  options: {
    app: { type: 'string', multiple: true },
    label: { type: 'string', multiple: true },
    setup: { type: 'string', default: 'empty' },
    out: { type: 'string' },
  },
})

async function prepareMaintainerLike(profile: PerfProfile) {
  await createMaintainerLikeProject(profile.projectPath, REPOSITORY)
  await writeMaintainerLikeHome(profile.home)
  await writeHeavyUserMcpConfig(profile)
}

async function measurePackagedPrefix(appPath: string, label: string | undefined, setup: string) {
  const app = resolvePerfApp(appPath, label)
  const maintainer = setup === 'maintainer'
  let agentRequests = 0
  const provider = await startFakeProvider(async (request, stream) => {
    if (isTitleRequest(request)) return stream.text('Prefix')
    agentRequests += 1
    if (maintainer && agentRequests === 1) {
      return stream.toolCalls([{ name: 'bash', arguments: { command: `sleep ${String(MCP_SETTLE_SECONDS)}` } }])
    }
    return stream.text('OK')
  })
  const environment = maintainer ? HEAVY_USER_MCP_ENVIRONMENT : {}
  try {
    return await withRunningApp(
      app,
      {
        mode: 'cold',
        sessionListText: null,
        timeoutMs: TIMEOUT_MS,
        warmHostIdleMs: 0,
        environment,
        prepareProfile: async (profile) => {
          await configureFakeProvider(profile.agentDir, provider.baseUrl)
          if (maintainer) await prepareMaintainerLike(profile)
        },
      },
      async ({ profile }) => {
        const run = startCliRun(app, profile, { prompt: PROMPT, model: FAKE_MODEL_REFERENCE, yolo: true, environment })
        await Promise.race([run.exited, delay(RUN_TIMEOUT_MS)])
        const requests = provider.requests
          .filter((request) => !isTitleRequest(request))
          .map((request) => measurePrefixTokens(prefixContentOfOpenAiRequest(request.body, PROMPT)))
        return { app: app.label, setup, requests }
      },
    )
  } finally {
    await provider.close()
  }
}

async function main() {
  const apps = values.app ?? []
  if (apps.length === 0) {
    process.stderr.write('Use --app <OpenWaggle.app> (repeatable) [--setup empty|maintainer]\n')
    process.exit(USAGE_EXIT_CODE)
  }
  const setup = values.setup ?? 'empty'
  const results = []
  for (const [index, appPath] of apps.entries()) {
    const result = await measurePackagedPrefix(appPath, values.label?.[index], setup)
    results.push(result)
    const [first, last] = [result.requests[0], result.requests.at(-1)]
    log(`${result.app} ${setup}: first ${String(first?.o200kTotal)} o200k (${String(first?.opusEstimateTotal)} Opus), last ${String(last?.o200kTotal)} o200k, ${String(last?.toolCount)} tools`)
  }
  const report = { kind: `first-turn-prefix-packaged-${setup}`, environment: measurementEnvironment(), results }
  if (values.out) log(`Wrote ${await writeJsonResult(values.out, `first-turn-prefix-packaged-${setup}.json`, report)}`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exitCode = 1
})
