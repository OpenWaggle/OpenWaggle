import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { executeLocalSessionCommand } from '../../src/main/session-host/local-session-client'
import { resolveLocalSessionHostPaths } from '../../src/main/session-host/local-session-paths'
import { HOST_UI_CONTRACT_VERSION } from '../../src/shared/types/host-ui-protocol'
import {
  childEnvironment,
  cliOutcome,
  findPackagedExecutable,
  findWorker,
  launchGui,
  readTranscript,
  runJsonCli,
  runProcess,
  stopChild,
  verifyExternalMcp,
  waitForHost,
  waitForIdle,
} from './live-session-orchestration-support'
import {
  transcriptInvokedSessionsSpawn,
  transcriptInvokedSkill,
} from './live-session-transcript-evidence'
import { prepareLiveQaCliExecutable } from './live-session-cli-executable'
import {
  reserveDebugPort,
  verifyLiveHiveGui,
  waitForLiveGui,
} from './live-session-orchestration-gui'
import { shutdownSessionHostForQa } from './session-host-shutdown'

const DEFAULT_MODEL = 'openai-codex/gpt-5.6-sol'
const DEFAULT_TIMEOUT_MS = 300_000
const QA_PROFILE_REMOVAL_MAX_RETRIES = 10
const QA_PROFILE_REMOVAL_RETRY_DELAY_MS = 100
const LIST_LIMIT = 20
const DISABLED_QA_SKILL = 'herdr-orchestration'
const DETACHED_HOST_SURVIVAL_DELAY_MS = 10_000

async function completeLiveQaCleanup(input: {
  readonly gui: ReturnType<typeof launchGui>
  readonly guiLogs: readonly (() => string)[]
  readonly passed: boolean
  readonly primaryFailure: { readonly error: unknown } | null
  readonly userDataRoot: string
}) {
  const cleanupErrors: unknown[] = []
  let closeSucceeded = true
  try {
    await stopChild(input.gui.child)
  } catch (error) {
    closeSucceeded = false
    cleanupErrors.push(error)
  }
  try {
    await shutdownSessionHostForQa(
      input.userDataRoot,
      input.passed && closeSucceeded
        ? () =>
            fs.rm(input.userDataRoot, {
              recursive: true,
              force: true,
              maxRetries: QA_PROFILE_REMOVAL_MAX_RETRIES,
              retryDelay: QA_PROFILE_REMOVAL_RETRY_DELAY_MS,
            })
        : async () => undefined,
    )
  } catch (error) {
    cleanupErrors.push(error)
    closeSucceeded = false
  }

  if (!input.passed || !closeSucceeded) {
    console.error(
      `Live QA data retained at ${input.userDataRoot}\n${input.guiLogs.map((read) => read()).join('\n')}`,
    )
  }
  if (input.primaryFailure && cleanupErrors.length > 0) {
    throw new AggregateError(
      [input.primaryFailure.error, ...cleanupErrors],
      'Live Session orchestration QA and its cleanup both failed.',
    )
  }
  if (input.primaryFailure) throw input.primaryFailure.error
  if (cleanupErrors.length === 1) throw cleanupErrors[0]
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, 'Live Session orchestration QA cleanup failed.')
  }
}

async function disableProjectSkillForQa(input: {
  readonly userDataRoot: string
  readonly projectPath: string
  readonly skillId: string
}) {
  const requestId = randomUUID()
  const result = await executeLocalSessionCommand({
    paths: resolveLocalSessionHostPaths({ userDataRoot: input.userDataRoot }),
    // This request exercises the same Host UI authority used by the local GUI. An internal
    // Session Host client is intentionally denied Host UI channels after the authority cutover.
    clientKind: 'gui',
    clientVersion: 'live-orchestration-qa',
    payload: {
      contract: 'host-ui-v1',
      request: {
        contractVersion: HOST_UI_CONTRACT_VERSION,
        requestId,
        channel: 'skills:set-enabled',
        args: [input.projectPath, input.skillId, false].map((value) => ({
          kind: 'value' as const,
          value,
        })),
      },
    },
  })
  if (
    result.contract !== 'host-ui-v1' ||
    result.response.requestId !== requestId ||
    result.response.channel !== 'skills:set-enabled' ||
    result.response.result.kind !== 'undefined'
  ) {
    throw new Error(`Session Host did not disable QA skill ${input.skillId}.`)
  }
}

async function readPackageIdentity(projectPath: string) {
  const parsed: unknown = JSON.parse(
    await fs.readFile(path.join(projectPath, 'package.json'), 'utf8'),
  )
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('name' in parsed) ||
    typeof parsed.name !== 'string' ||
    !('version' in parsed) ||
    typeof parsed.version !== 'string'
  ) {
    throw new Error('Project package.json must declare string name and version fields.')
  }
  return { name: parsed.name, version: parsed.version }
}

async function main() {
  const executable = await findPackagedExecutable()
  const userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-live-orchestration-'))
  const env = childEnvironment(userDataRoot)
  const cliExecutable = await prepareLiveQaCliExecutable({
    executable,
    workingDirectory: userDataRoot,
  })
  const projectPath = process.cwd()
  const model = process.env.OPENWAGGLE_LIVE_MODEL?.trim() || DEFAULT_MODEL
  const timeoutMs = Number(process.env.OPENWAGGLE_LIVE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)
  const expectedPackage = await readPackageIdentity(projectPath)
  await waitForHost(cliExecutable, env)
  await new Promise((resolve) => setTimeout(resolve, DETACHED_HOST_SURVIVAL_DELAY_MS))
  await waitForHost(cliExecutable, env)
  await disableProjectSkillForQa({
    userDataRoot,
    projectPath,
    skillId: DISABLED_QA_SKILL,
  })
  let debugPort = await reserveDebugPort()
  let gui = launchGui(executable, env, [`--remote-debugging-port=${String(debugPort)}`])
  const guiLogs = [gui.logs]
  let passed = false
  let primaryFailure: { readonly error: unknown } | null = null

  try {
    await waitForHost(cliExecutable, env)
    await waitForLiveGui(debugPort, timeoutMs)
    const launch = await runJsonCli(cliExecutable, env, [
      'sessions',
      'launch',
      projectPath,
      '--title',
      'Packaged live Queen Worker QA',
      '--text',
      'Use the native sessions tool to spawn exactly one Worker in the shared parent workspace. Do not use any external orchestration skill. Ask the Worker to inspect package.json and report the package name and version without modifying files. Wait for it, read its report, then answer with its Session ID, package name, and version. Do not inspect package.json yourself.',
      '--model',
      model,
      '--thinking',
      'low',
      '--yolo',
      '--interaction-timeout-ms',
      String(timeoutMs),
      '--workspace',
      'current',
    ])
    const queenSessionId = cliOutcome(launch).sessionId
    if (typeof queenSessionId !== 'string') throw new Error('Launch omitted Queen Session ID.')
    await stopChild(gui.child)
    await waitForHost(cliExecutable, env)
    await waitForIdle(cliExecutable, env, queenSessionId, timeoutMs)
    const list = await runJsonCli(cliExecutable, env, [
      'sessions',
      'list',
      '--all',
      '--limit',
      String(LIST_LIMIT),
    ])
    const workerSessionId = findWorker(list, queenSessionId)
    const queenTranscript = await readTranscript(cliExecutable, env, queenSessionId)
    if (transcriptInvokedSkill(queenTranscript, DISABLED_QA_SKILL)) {
      throw new Error(`Queen transcript unexpectedly used disabled skill ${DISABLED_QA_SKILL}.`)
    }
    if (!transcriptInvokedSessionsSpawn(queenTranscript)) {
      throw new Error('Queen transcript omitted a native sessions spawn tool call.')
    }
    for (const expected of [workerSessionId, expectedPackage.name, expectedPackage.version]) {
      if (!queenTranscript.includes(String(expected))) {
        throw new Error(`Queen transcript omitted ${JSON.stringify(expected)}.`)
      }
    }
    await verifyExternalMcp({
      executable: cliExecutable,
      env,
      projectPath,
      queenSessionId,
      workerSessionId,
      timeoutMs,
    })
    const workerTranscript = await readTranscript(cliExecutable, env, workerSessionId)
    if (!workerTranscript.includes('EXTERNAL-MCP-OK')) {
      throw new Error('Worker transcript omitted the external MCP reply.')
    }
    const exported = await runProcess(
      cliExecutable,
      ['sessions', 'export', queenSessionId, '--format', 'markdown', '--scope', 'tree'],
      env,
    )
    if (!exported.stdout.includes(workerSessionId)) {
      throw new Error('Markdown tree export omitted the Worker Session ID.')
    }
    debugPort = await reserveDebugPort()
    gui = launchGui(executable, env, [`--remote-debugging-port=${String(debugPort)}`])
    guiLogs.push(gui.logs)
    const screenshotPath = await verifyLiveHiveGui({
      debugPort,
      queenTitle: 'Packaged live Queen Worker QA',
      timeoutMs,
    })
    passed = true
    console.log(
      JSON.stringify({
        passed,
        queenSessionId,
        workerSessionId,
        model,
        package: expectedPackage.name,
        version: expectedPackage.version,
        spawnProvenance: 'pi-native-sessions-tool',
        screenshotPath,
      }),
    )
  } catch (error) {
    primaryFailure = { error }
  }
  await completeLiveQaCleanup({ gui, guiLogs, passed, primaryFailure, userDataRoot })
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
