import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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

const DEFAULT_MODEL = 'openai-codex/gpt-5.6-sol'
const DEFAULT_TIMEOUT_MS = 300_000
const LIST_LIMIT = 20
const DISABLED_QA_SKILL = 'herdr-orchestration'

async function disableProjectSkillForQa(input: {
  readonly userDataRoot: string
  readonly projectPath: string
  readonly skillId: string
}) {
  const databaseDirectory = path.join(input.userDataRoot, 'session-host')
  await fs.mkdir(databaseDirectory, { recursive: true })
  const database = new DatabaseSync(path.join(databaseDirectory, 'session-host.sqlite'))
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS settings_store (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    database
      .prepare(
        `INSERT INTO settings_store (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        'skillTogglesByProject',
        JSON.stringify({ [input.projectPath]: { [input.skillId]: false } }),
        Date.now(),
      )
  } finally {
    database.close()
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
  const projectPath = process.cwd()
  const model = process.env.OPENWAGGLE_LIVE_MODEL?.trim() || DEFAULT_MODEL
  const timeoutMs = Number(process.env.OPENWAGGLE_LIVE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)
  const expectedPackage = await readPackageIdentity(projectPath)
  const bootstrapGui = launchGui(executable, env)
  try {
    await waitForHost(executable, env)
  } finally {
    await stopChild(bootstrapGui.child)
  }
  await disableProjectSkillForQa({
    userDataRoot,
    projectPath,
    skillId: DISABLED_QA_SKILL,
  })
  const gui = launchGui(executable, env)
  let passed = false

  try {
    await waitForHost(executable, env)
    const launch = await runJsonCli(executable, env, [
      'sessions',
      'launch',
      projectPath,
      '--title',
      'Packaged live Queen Worker QA',
      '--text',
      'Use the native sessions tool to spawn exactly one Worker in the shared parent workspace. Do not use herdr or any external orchestration skill. Ask the Worker to inspect package.json and report the package name and version without modifying files. Wait for it, read its report, then answer with its Session ID, package name, and version. Do not inspect package.json yourself.',
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
    await waitForIdle(executable, env, queenSessionId, timeoutMs)
    const list = await runJsonCli(executable, env, [
      'sessions',
      'list',
      '--all',
      '--limit',
      String(LIST_LIMIT),
    ])
    const workerSessionId = findWorker(list, queenSessionId)
    const queenTranscript = await readTranscript(executable, env, queenSessionId)
    if (queenTranscript.includes(DISABLED_QA_SKILL)) {
      throw new Error(`Queen transcript unexpectedly used disabled skill ${DISABLED_QA_SKILL}.`)
    }
    for (const expected of [workerSessionId, expectedPackage.name, expectedPackage.version]) {
      if (!queenTranscript.includes(String(expected))) {
        throw new Error(`Queen transcript omitted ${JSON.stringify(expected)}.`)
      }
    }
    await verifyExternalMcp({
      executable,
      env,
      projectPath,
      queenSessionId,
      workerSessionId,
      timeoutMs,
    })
    const workerTranscript = await readTranscript(executable, env, workerSessionId)
    if (!workerTranscript.includes('EXTERNAL-MCP-OK')) {
      throw new Error('Worker transcript omitted the external MCP reply.')
    }
    const exported = await runProcess(
      executable,
      ['sessions', 'export', queenSessionId, '--format', 'markdown', '--scope', 'tree'],
      env,
    )
    if (!exported.stdout.includes(workerSessionId)) {
      throw new Error('Markdown tree export omitted the Worker Session ID.')
    }
    passed = true
    console.log(
      JSON.stringify({
        passed,
        queenSessionId,
        workerSessionId,
        model,
        package: expectedPackage.name,
        version: expectedPackage.version,
      }),
    )
  } finally {
    await stopChild(gui.child)
    if (passed) await fs.rm(userDataRoot, { recursive: true, force: true })
    else console.error(`Live QA data retained at ${userDataRoot}\n${gui.logs()}`)
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
