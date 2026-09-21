import { constants } from 'node:fs'
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeUnknownOrThrow, parseJsonUnknown, Schema } from '@shared/schema'
import type { ActionInvocation, ResolvedActionInvocation } from '@shared/types/action-definitions'
import { getInteractiveTerminalEnv } from '../../env'
import type { ActionRunWorkspace } from '../../ports/action-run-service'
import type { ActionProcess, ActionProcessRunner } from './action-process'
import { createPreparationProcessOwnership } from './preparation-process-ownership'
import { resolveActionInvocation } from './task-discovery'

const ENVIRONMENT_BYTES = 512 * 1_024
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const transientNames = new Set(['_', 'PWD', 'OLDPWD', 'SHLVL', 'ELECTRON_RUN_AS_NODE'])
const quotePosix = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const quotePowerShell = (value: string) => `'${value.replaceAll("'", "''")}'`

export function preparationCaptureInvocation(
  invocation: ResolvedActionInvocation,
  destination: string,
  platform = process.platform,
): ResolvedActionInvocation {
  if (platform === 'win32') {
    const command =
      invocation.type === 'command'
        ? invocation.command
        : `& ${[invocation.executable, ...invocation.args].map(quotePowerShell).join(' ')}`
    return {
      type: 'executable',
      cwd: invocation.cwd,
      executable: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$global:LASTEXITCODE = 0\ntry {\n${command}\nif (-not $?) { $global:LASTEXITCODE = 1 }\n} finally {\nif ($global:LASTEXITCODE -eq 0) { $values = @{}; Get-ChildItem Env: | ForEach-Object { $values[$_.Name] = $_.Value }; [System.IO.File]::WriteAllText(${quotePowerShell(destination)}, ($values | ConvertTo-Json -Compress)) }\n}\nexit $global:LASTEXITCODE`,
      ],
    }
  }
  const command =
    invocation.type === 'command'
      ? invocation.command
      : [invocation.executable, ...invocation.args].map(quotePosix).join(' ')
  // An EXIT trap also handles an explicit successful `exit` in the user's setup command.
  const capture = `__ow_exit=$?; if [ "$__ow_exit" -eq 0 ]; then /usr/bin/env -0 > ${quotePosix(destination)} || __ow_exit=$?; fi; exit "$__ow_exit"`
  return {
    type: 'executable',
    cwd: invocation.cwd,
    executable: '/bin/sh',
    args: ['-c', `umask 077\ntrap ${quotePosix(capture)} EXIT\n${command}`],
  }
}
async function readCapturedEnvironment(path: string): Promise<Readonly<Record<string, string>>> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const identity = await handle.stat()
    if (!identity.isFile() || identity.size > ENVIRONMENT_BYTES)
      throw new Error('The setup environment export is invalid or too large.')
    const source = await handle.readFile('utf8')
    if (!source)
      throw new Error(
        'Setup completed without an environment export. Review its exit behavior and retry.',
      )
    if (Buffer.byteLength(source) > ENVIRONMENT_BYTES)
      throw new Error('The setup environment export is too large.')
    if (process.platform === 'win32')
      return decodeUnknownOrThrow(
        Schema.Record({ key: Schema.String, value: Schema.String }),
        parseJsonUnknown(source),
      )
    const environment: Record<string, string> = {}
    for (const entry of source.split('\0')) {
      const separator = entry.indexOf('=')
      if (separator > 0) environment[entry.slice(0, separator)] = entry.slice(separator + 1)
    }
    return environment
  } finally {
    await handle.close()
  }
}
export function createPreparationExecutor(
  runner: ActionProcessRunner,
  directory: string,
  appVersion: string,
) {
  const ownership = createPreparationProcessOwnership()
  const spawning = new Set<Promise<ActionProcess>>()
  let shuttingDown = false
  const execute = async (input: {
    readonly workspace: ActionRunWorkspace
    readonly invocation: ActionInvocation
    readonly environment: Readonly<Record<string, string>>
    readonly captureEnvironment: boolean
    readonly signal?: AbortSignal
    readonly onOutput: (chunk: string) => void
  }) => {
    if (shuttingDown) throw new Error('The Session Host is stopping.')
    const resolved = await resolveActionInvocation(input.workspace.workspacePath, input.invocation)
    const environment = {
      ...input.environment,
      OPENWAGGLE_PROJECT_ROOT: input.workspace.projectPath,
      OPENWAGGLE_WORKTREE_PATH: input.workspace.workspacePath,
    }
    await runner.validate(resolved, environment)
    await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
    const temporary = await mkdtemp(join(directory, 'preparation-'))
    const destination = join(temporary, 'environment')
    const file = await open(destination, 'wx', PRIVATE_FILE_MODE)
    await file.close()
    try {
      const invocation = input.captureEnvironment
        ? preparationCaptureInvocation(resolved, destination)
        : resolved
      if (shuttingDown) throw new Error('The Session Host is stopping.')
      input.signal?.throwIfAborted()
      const pending = runner.start({ invocation, environment, onOutput: input.onOutput })
      spawning.add(pending)
      let child: ActionProcess
      try {
        child = await pending
        ownership.add(child, input.onOutput)
      } finally {
        spawning.delete(pending)
      }
      let exitCode: number | null
      const stop = () => {
        void ownership.stop(child)
      }
      input.signal?.addEventListener('abort', stop, { once: true })
      try {
        if (shuttingDown || input.signal?.aborted) await ownership.stop(child)
        exitCode = (await child.closed).exitCode
      } finally {
        await ownership.stop(child)
        input.signal?.removeEventListener('abort', stop)
      }
      input.signal?.throwIfAborted()
      if (exitCode !== 0 || !input.captureEnvironment)
        return { exitCode, environment: input.environment }
      const exported = await readCapturedEnvironment(destination)
      const baseline = getInteractiveTerminalEnv(appVersion, {})
      const changes = Object.fromEntries(
        Object.entries(exported).filter(
          ([name, value]) => !transientNames.has(name) && value !== baseline[name],
        ),
      )
      return { exitCode, environment: changes }
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
  return Object.assign(execute, {
    shutdown: async () => {
      shuttingDown = true
      await Promise.allSettled(spawning)
      await ownership.stopAll()
    },
  })
}
