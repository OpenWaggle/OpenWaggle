import { randomUUID } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
import type { ActionDefinition } from '@shared/types/action-definitions'
import type { ActionRun } from '@shared/types/action-runs'
import { normalizeBrowserPreviewAddress } from '@shared/utils/browser-preview-url'
import type { PreparedEnvironment } from '../../domain/prepared-environment'
import type { StartManagedActionInput } from '../../ports/action-run-service'
import { createTerminalHistorySanitizer } from '../terminal/terminal-history-sanitizer'
import { createTerminalScrollback } from '../terminal/terminal-scrollback'
import type { ActionProcess } from './action-process'
import { previewFromActionOutput } from './action-run-output'
import type { ManagedActionDependencies } from './managed-action-runs'

const URL_LOOKBEHIND_CHARACTERS = 4_096
export interface LiveAction {
  run: ActionRun
  readonly process: ActionProcess
  readonly output: ReturnType<typeof createTerminalScrollback>
  readonly release: () => void
  finishing: Promise<void> | null
}
export interface StartingAction {
  run: ActionRun
  cancelRequested: boolean
  readonly abort: AbortController
  readonly settled: Promise<void>
  readonly resolveSettled: () => void
  stopPromise: Promise<void> | null
}
export interface ManagedLaunchContext {
  readonly deps: ManagedActionDependencies
  readonly active: Map<string, LiveAction>
  readonly starting: Map<string, StartingAction>
  readonly persist: (run: ActionRun) => Promise<void>
  readonly watchPreview: (run: ActionRun) => void
  readonly finish: (entry: LiveAction, exitCode: number | null) => Promise<void>
  readonly stopEntry: (entry: LiveAction) => Promise<void>
  readonly scheduleMetadata: (runId: string) => void
}
export const historyKey = (run: ActionRun) => `action:${run.workspaceId}::${run.id}`

function outputHandler(
  context: ManagedLaunchContext,
  starting: StartingAction,
  output: LiveAction['output'],
  configuredPreviewUrl: string | null,
  getRun: () => ActionRun,
  setRun: (run: ActionRun) => void,
) {
  const sanitizer = createTerminalHistorySanitizer()
  let lookbehind = ''
  return (chunk: string) => {
    const clean = stripVTControlCharacters(sanitizer.feed(chunk))
    output.append(clean)
    const run = getRun()
    context.deps.history.append(historyKey(run), clean)
    lookbehind = (lookbehind + clean).slice(-URL_LOOKBEHIND_CHARACTERS)
    const current = context.active.get(run.id)
    const previous = current?.run ?? run
    const previewUrl =
      configuredPreviewUrl ?? previewFromActionOutput(lookbehind) ?? previous.previewUrl
    const updated = {
      ...previous,
      outputBytes: previous.outputBytes + Buffer.byteLength(clean),
      previewUrl,
      ready: previewUrl === previous.previewUrl && previous.ready,
    }
    setRun(updated)
    starting.run = updated
    if (current) current.run = updated
    if (current) context.watchPreview(updated)
    context.scheduleMetadata(updated.id)
  }
}

async function handleLateLaunch(
  context: ManagedLaunchContext,
  starting: StartingAction,
  runId: string,
  output: LiveAction['output'],
  release: () => void,
  process: ActionProcess,
) {
  await starting.settled
  const entry: LiveAction = {
    run: { ...starting.run, status: 'stopping', ready: false },
    process,
    output,
    release,
    finishing: null,
  }
  context.active.set(runId, entry)
  void process.closed
    .then(({ exitCode }) => context.finish(entry, exitCode))
    .catch(context.deps.reportError)
  await context.stopEntry(entry)
}

async function awaitCancellableLaunch(
  starting: StartingAction,
  launch: Promise<ActionProcess>,
  ownership: { transferred: boolean },
  onLate: (process: ActionProcess) => Promise<void>,
  release: () => void,
  reportError: (error: unknown) => void,
) {
  const canceled = Promise.withResolvers<ActionProcess>()
  const cancel = () => canceled.reject(new Error('Action launch canceled.'))
  starting.abort.signal.addEventListener('abort', cancel, { once: true })
  try {
    return await Promise.race([launch, canceled.promise])
  } catch (error) {
    if (starting.cancelRequested) {
      ownership.transferred = true
      void launch.then(onLate, () => release()).catch(reportError)
    }
    throw error
  } finally {
    starting.abort.signal.removeEventListener('abort', cancel)
  }
}

function failedLaunchRun(run: ActionRun, starting: StartingAction, error: unknown): ActionRun {
  return {
    ...run,
    status: starting.cancelRequested ? 'stopped' : 'failed',
    error: starting.cancelRequested ? null : error instanceof Error ? error.message : String(error),
    finishedAt: Date.now(),
  }
}

export async function launchManagedAction(
  context: ManagedLaunchContext,
  input: StartManagedActionInput,
  action: ActionDefinition,
  invocation: ActionRun['invocation'],
  environment: PreparedEnvironment,
) {
  const release = context.deps.acquireLiveness()
  const configuredPreviewUrl = action.previewUrl
    ? normalizeBrowserPreviewAddress(action.previewUrl)
    : null
  let run: ActionRun = {
    id: randomUUID(),
    requestId: input.requestId,
    workspaceId: input.workspace.workspaceId,
    projectPath: input.workspace.projectPath,
    workspacePath: input.workspace.workspacePath,
    action,
    invocation,
    status: 'starting',
    startedAt: Date.now(),
    finishedAt: null,
    exitCode: null,
    error: null,
    previewUrl: configuredPreviewUrl,
    ready: false,
    outputBytes: 0,
  }
  const settled = Promise.withResolvers<void>()
  const starting: StartingAction = {
    run,
    cancelRequested: false,
    abort: new AbortController(),
    settled: settled.promise,
    resolveSettled: settled.resolve,
    stopPromise: null,
  }
  context.starting.set(run.id, starting)
  const output = createTerminalScrollback()
  const ownership = { transferred: false }
  try {
    await context.persist(run)
    await context.deps.persistence.recordRequest(
      run.workspaceId,
      action.id,
      input.requestId,
      run.id,
    )
    await context.deps.history.registerWorkingDirectory(historyKey(run), invocation.cwd)
    if (starting.cancelRequested) throw new Error('Action launch canceled.')
    const launch = context.deps.runner.start({
      invocation,
      environment,
      signal: starting.abort.signal,
      onOutput: outputHandler(
        context,
        starting,
        output,
        configuredPreviewUrl,
        () => run,
        (next) => {
          run = next
        },
      ),
    })
    const child = await awaitCancellableLaunch(
      starting,
      launch,
      ownership,
      (late) => handleLateLaunch(context, starting, run.id, output, release, late),
      release,
      context.deps.reportError,
    )
    run = { ...run, status: 'running' }
    const entry: LiveAction = { run, process: child, output, release, finishing: null }
    context.active.set(run.id, entry)
    context.watchPreview(run)
    void child.closed
      .then(({ exitCode }) => context.finish(entry, exitCode))
      .catch(context.deps.reportError)
    if (starting.cancelRequested) {
      await context.stopEntry(entry)
      return (await context.deps.persistence.get(run.id)) ?? entry.run
    }
    await context.persist(run)
    return context.active.get(run.id)?.run ?? (await context.deps.persistence.get(run.id)) ?? run
  } catch (error) {
    if (context.active.has(run.id)) throw error
    if (!ownership.transferred) release()
    await context.persist(failedLaunchRun(run, starting, error))
    if (!starting.cancelRequested) throw error
    return (await context.deps.persistence.get(run.id)) ?? run
  } finally {
    context.starting.delete(run.id)
    starting.resolveSettled()
  }
}
