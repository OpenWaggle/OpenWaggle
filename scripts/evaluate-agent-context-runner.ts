import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { startCliRun } from './perf/lib/cli-run'
import type { PerfApp } from './perf/lib/perf-app'
import { launchApp, stopProcessGroup } from './perf/lib/perf-app'
import { type PerfProfile, profileEnvironment } from './perf/lib/perf-profile'
import { delay, withRunningApp } from './perf/lib/running-app'
import { addUsage, emptyUsage, readRunTranscripts, type SessionTranscriptSummary } from './evaluate-agent-context-transcript'
import type { EvalOutcome, EvalTask } from './evaluate-agent-context-types'

const DEFAULT_TASK_TIMEOUT_MS = 480_000
const APP_TIMEOUT_MS = 120_000
const VERIFY_TIMEOUT_MS = 60_000
const EPHEMERAL_PORT = 0
const LOCALHOST = '127.0.0.1'
const HTTP_OK = 200
const JSON_INDENT = 2
const KEPT_OUTPUT_CHARS = 2_000
const KEPT_ANSWER_CHARS = 1_000
const FIXTURE_SERVER = path.join(import.meta.dirname, 'perf', 'fixtures', 'mcp-fixture-server', 'server.ts')

export interface EvalRunInput {
  readonly app: PerfApp
  readonly task: EvalTask
  readonly rep: number
  readonly model: string
  /** Environment for the app and the CLI, such as AWS_PROFILE for Bedrock. */
  readonly environment: Readonly<Record<string, string>>
}

async function servePage(html: string | undefined) {
  if (!html) return null
  const server = createServer((_request, response) => {
    response.writeHead(HTTP_OK, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html)
  })
  await new Promise<void>((resolve) => server.listen(EPHEMERAL_PORT, LOCALHOST, () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : EPHEMERAL_PORT
  return { url: `http://${LOCALHOST}:${String(port)}/`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

/** The fixture project, the inventory MCP server and the user's AWS configuration (read-only use). */
async function prepareTaskProfile(task: EvalTask, profile: PerfProfile) {
  await symlink(path.join(os.userInfo().homedir, '.aws'), path.join(profile.home, '.aws')).catch(() => undefined)
  await task.setup?.(profile.projectPath)
  execFileSync('git', ['add', '-A'], { cwd: profile.projectPath })
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'fixture'], { cwd: profile.projectPath })
  await task.afterCommit?.(profile.projectPath)
  if (!task.mcpInventory) return
  const config = { mcpServers: { inventory: { command: 'node', args: [FIXTURE_SERVER, 'inventory'], exposure: 'direct' } } }
  await mkdir(profile.agentDir, { recursive: true })
  await writeFile(path.join(profile.agentDir, 'mcp.json'), `${JSON.stringify(config, null, JSON_INDENT)}\n`)
}

async function readInspected(projectPath: string, files: readonly string[] = []) {
  const entries = await Promise.all(
    files.map(async (file) => [file, await readFile(path.join(projectPath, file), 'utf8').catch(() => null)] as const),
  )
  return Object.fromEntries(entries)
}

function runVerifications(projectPath: string, commands: readonly string[] = []) {
  return Object.fromEntries(
    commands.map((command) => {
      const result = spawnSync('/bin/sh', ['-c', command], { cwd: projectPath, encoding: 'utf8', timeout: VERIFY_TIMEOUT_MS })
      return [command, { exitCode: result.status ?? -1, output: `${result.stdout}${result.stderr}`.slice(-KEPT_OUTPUT_CHARS) }]
    }),
  )
}

function rootTranscript(transcripts: readonly SessionTranscriptSummary[]) {
  return transcripts.find((transcript) => transcript.isRoot) ?? transcripts[0]
}

export async function outcomeOf(task: EvalTask, profile: PerfProfile) {
  const transcripts = await readRunTranscripts(profile.agentDir)
  const usage = emptyUsage()
  for (const transcript of transcripts) addUsage(usage, { ...transcript.usage, cost: { total: transcript.usage.costUsd } })
  const outcome: EvalOutcome = {
    answer: rootTranscript(transcripts)?.finalText ?? '',
    files: await readInspected(profile.projectPath, task.inspectFiles),
    toolNames: transcripts.flatMap((transcript) => transcript.toolNames),
    sessionCount: transcripts.length,
    compactions: transcripts.reduce((total, transcript) => total + transcript.compactions, 0),
    verifications: runVerifications(profile.projectPath, task.verify),
  }
  const modelCalls = transcripts.reduce((total, transcript) => total + transcript.modelCalls, 0)
  return { outcome, usage, modelCalls }
}

/** Sessions that exist before the task's Run, created with `openwaggle hive create`. */
async function precreateSessions(app: PerfApp, profile: PerfProfile, task: EvalTask, environment: Readonly<Record<string, string>>) {
  for (const title of task.otherSessions ?? []) {
    const created = launchApp(app, profileEnvironment(profile, environment), ['--use-mock-keychain', 'hive', 'create', profile.projectPath, '--title', title])
    await Promise.race([new Promise((resolve) => created.child.once('exit', resolve)), delay(APP_TIMEOUT_MS)])
    await stopProcessGroup(created.child)
  }
}

async function applySettings(page: Parameters<Parameters<typeof withRunningApp>[2]>[0]['page'], settings: Readonly<Record<string, unknown>>) {
  await page.evaluate(async (values) => {
    const api: unknown = Reflect.get(globalThis, 'api')
    const update: unknown = typeof api === 'object' && api !== null ? Reflect.get(api, 'updateSettings') : null
    if (typeof update === 'function') await Promise.resolve(Reflect.apply(update, api, [values]))
  }, settings)
}

/** One repetition of one task, on a fresh profile with the app's window attached. */
export async function runEvalTask(input: EvalRunInput) {
  const { app, task } = input
  const page = await servePage(task.previewPage)
  const startedAt = Date.now()
  try {
    return await withRunningApp(
      app,
      {
        mode: 'cold',
        sessionListText: null,
        timeoutMs: APP_TIMEOUT_MS,
        warmHostIdleMs: 0,
        environment: input.environment,
        prepareProfile: (profile) => prepareTaskProfile(task, profile),
      },
      async ({ profile, page: window }) => {
        await applySettings(window, { selectedModel: input.model, ...task.settings })
        await precreateSessions(app, profile, task, input.environment)
        const title = `Eval ${task.id}`
        const run = startCliRun(app, profile, {
          prompt: task.prompt({ previewUrl: page?.url ?? null }),
          model: input.model,
          yolo: true,
          environment: input.environment,
          title,
        })
        // The browser preview belongs to the Session the window shows, so open it there.
        if (task.previewPage) await window.getByText(title, { exact: true }).first().click({ timeout: APP_TIMEOUT_MS })
        const exit = await Promise.race([run.exited, delay(task.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS).then(() => 'timeout' as const)])
        if (exit === 'timeout') await stopProcessGroup(run.launched.child)
        const { outcome, usage, modelCalls } = await outcomeOf(task, profile)
        const result = task.grade(outcome)
        return {
          taskId: task.id,
          group: task.group,
          rep: input.rep,
          app: app.label,
          model: input.model,
          pass: result.pass,
          reason: result.reason,
          exit,
          wallMs: Date.now() - startedAt,
          modelCalls,
          toolCalls: outcome.toolNames.filter((name) => !name.startsWith('codemode:')).length,
          toolSearchCalls: outcome.toolNames.filter((name) => name === 'tool_search').length,
          sessions: outcome.sessionCount,
          compactions: outcome.compactions,
          usage,
          totalTokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
          toolNames: outcome.toolNames,
          answer: outcome.answer.slice(0, KEPT_ANSWER_CHARS),
        }
      },
    )
  } finally {
    await page?.close()
  }
}

export type EvalRunRecord = Awaited<ReturnType<typeof runEvalTask>>
