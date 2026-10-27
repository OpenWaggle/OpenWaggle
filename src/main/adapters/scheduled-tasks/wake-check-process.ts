import { type ChildProcess, spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import {
  HEARTBEAT_WAKE_CHECK_OUTPUT_LIMIT_BYTES,
  HEARTBEAT_WAKE_CHECK_TIMEOUT_MS,
} from '@shared/types/scheduled-task-heartbeat'
import * as Effect from 'effect/Effect'
import { app } from 'electron'
import type {
  WakeCheckExecution,
  WakeCheckRequest,
} from '../../domain/scheduled-tasks/wake-check-decision'
import { getInteractiveTerminalEnv } from '../../env'
import { createLogger } from '../../logger'
import { processCommand } from '../project-actions/action-process'

const logger = createLogger('scheduled-task-wake-check')
const TREE_KILL_TIMEOUT_MS = 1_000
/** How long output may keep arriving after the command exits, from something it left running. */
const EXIT_DRAIN_MS = 500

export interface WakeCheckProcessOptions {
  readonly appVersion: string
  readonly timeoutMs?: number
  readonly outputLimitBytes?: number
}

/** Collects one stream up to the cap and drains the rest, so a chatty command never blocks. */
function boundedStream(limit: number) {
  const chunks: Buffer[] = []
  let bytes = 0
  let truncated = false
  return {
    push(chunk: Buffer) {
      const room = limit - bytes
      if (room <= 0) {
        truncated = true
        return
      }
      const kept = chunk.length > room ? chunk.subarray(0, room) : chunk
      if (kept.length < chunk.length) truncated = true
      chunks.push(kept)
      bytes += kept.length
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
    get truncated() {
      return truncated
    },
  }
}

function errorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function killDirect(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    child.kill('SIGKILL')
  } catch (error) {
    if (errorCode(error) !== 'ESRCH')
      logger.warn('Wake check kill failed', { error: String(error) })
  }
}

/** Stops the command and everything it started: its process group, or its Windows tree. */
function killTree(child: ChildProcess) {
  const pid = child.pid
  if (!pid) return
  if (process.platform !== 'win32') {
    // The command leads its own group, which stays addressable after it exits while a
    // descendant still runs.
    try {
      process.kill(-pid, 'SIGKILL')
    } catch (error) {
      if (errorCode(error) !== 'ESRCH') killDirect(child)
    }
    return
  }
  // taskkill finds the tree through the root PID; once that exited, the PID may be reused.
  if (child.exitCode !== null || child.signalCode !== null) return
  const treeKill = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  const timeout = setTimeout(() => killDirect(treeKill), TREE_KILL_TIMEOUT_MS)
  timeout.unref?.()
  treeKill.once('error', () => {
    clearTimeout(timeout)
    killDirect(child)
  })
  treeKill.once('close', (code) => {
    clearTimeout(timeout)
    if (code !== 0) killDirect(child)
  })
  treeKill.unref()
}

function startFailure(message: string): WakeCheckExecution {
  return {
    exitCode: null,
    signal: null,
    timedOut: false,
    stdout: '',
    stderr: '',
    truncated: false,
    startError: message,
  }
}

async function workingDirectoryProblem(workingPath: string) {
  try {
    return (await stat(workingPath)).isDirectory()
      ? null
      : 'The Session workspace is not a directory.'
  } catch {
    return 'The Session workspace no longer exists.'
  }
}

/**
 * Runs a Heartbeat's Wake check (#388) the way a Project action runs a command: the user's shell
 * in the Session's workspace, with the interactive terminal environment (app-control and code
 * injection variables removed) plus the workspace paths. It gets no input, a 30 s limit after
 * which its whole process tree is killed, and 16 KiB of output per stream.
 */
export async function runWakeCheckProcess(
  request: WakeCheckRequest,
  options: WakeCheckProcessOptions,
): Promise<WakeCheckExecution> {
  const problem = await workingDirectoryProblem(request.workingPath)
  if (problem) return startFailure(problem)
  const environment = getInteractiveTerminalEnv(options.appVersion, {
    OPENWAGGLE_PROJECT_ROOT: request.projectPath ?? request.workingPath,
    OPENWAGGLE_WORKTREE_PATH: request.workingPath,
  })
  let execution: { readonly command: string; readonly args: readonly string[] }
  try {
    execution = await processCommand(
      { type: 'command', command: request.command, cwd: request.workingPath },
      environment,
    )
  } catch (error) {
    return startFailure(error instanceof Error ? error.message : String(error))
  }
  const limit = options.outputLimitBytes ?? HEARTBEAT_WAKE_CHECK_OUTPUT_LIMIT_BYTES
  return new Promise((resolve) => {
    const stdout = boundedStream(limit)
    const stderr = boundedStream(limit)
    let timedOut = false
    let settled = false
    let exit: { readonly code: number | null; readonly signal: string | null } | null = null
    const child = spawn(execution.command, [...execution.args], {
      cwd: request.workingPath,
      env: environment,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const finish = (result: WakeCheckExecution) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }
    const collected = (): WakeCheckExecution => ({
      exitCode: exit?.code ?? null,
      signal: exit?.signal ?? null,
      timedOut,
      stdout: stdout.text(),
      stderr: stderr.text(),
      truncated: stdout.truncated || stderr.truncated,
    })
    const timeout = setTimeout(() => {
      timedOut = true
      killTree(child)
      // A process the kill could not reach may hold the output open; stop waiting for it.
      setTimeout(() => {
        child.stdout?.destroy()
        child.stderr?.destroy()
        finish(collected())
      }, EXIT_DRAIN_MS).unref?.()
    }, options.timeoutMs ?? HEARTBEAT_WAKE_CHECK_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.once('error', (error) => finish(startFailure(error.message)))
    child.once('exit', (code, signal) => {
      exit = { code, signal }
      // Something the command left running may hold its output open; it gets no more time.
      setTimeout(() => killTree(child), EXIT_DRAIN_MS).unref?.()
    })
    child.once('close', () => finish(collected()))
  })
}

/** The Session Host's Wake check runner, with this app's version in the terminal environment. */
export function runHostWakeCheck(request: WakeCheckRequest) {
  return Effect.promise(() => runWakeCheckProcess(request, { appVersion: app.getVersion() }))
}
