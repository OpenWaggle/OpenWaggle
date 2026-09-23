import type { ActionCatalog, ActionDefinition } from '@shared/types/action-definitions'
import { type ActionRun, isActiveActionRun } from '@shared/types/action-runs'
import { enqueueProjectConfigWrite } from '../../config/project-config-write-queue'
import type { PreparedEnvironment } from '../../domain/prepared-environment'
import type { ActionCatalogScope } from '../../ports/action-catalog-service'
import type { ActionRunWorkspace, StartManagedActionInput } from '../../ports/action-run-service'
import type { TerminalHistoryStore } from '../terminal/terminal-history-store'
import { resolveManagedActionLaunch } from './action-launch-preflight'
import { ActionPreviewReadiness, type probeActionPreview } from './action-preview-readiness'
import type { ActionProcessRunner } from './action-process'
import { actionOutputPage } from './action-run-output'
import type { ActionRunPersistence } from './action-run-persistence'
import {
  historyKey,
  type LiveAction,
  launchManagedAction,
  type StartingAction,
} from './managed-action-launch'

const METADATA_FLUSH_MS = 1_000
export interface ManagedActionDependencies {
  readonly persistence: ActionRunPersistence
  readonly history: TerminalHistoryStore
  readonly runner: ActionProcessRunner
  readonly catalog: (scope: ActionCatalogScope) => Promise<ActionCatalog>
  readonly environment: (workspace: ActionRunWorkspace) => Promise<PreparedEnvironment>
  readonly acquireLiveness: () => () => void
  readonly reportError: (error: unknown) => void
  readonly probePreview?: typeof probeActionPreview
}

export class ManagedActionRuns {
  private readonly active = new Map<string, LiveAction>()
  private readonly starting = new Map<string, StartingAction>()
  private readonly metadataWrites = new Map<string, Promise<void>>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly previews: ActionPreviewReadiness
  constructor(private readonly deps: ManagedActionDependencies) {
    this.previews = new ActionPreviewReadiness(deps.probePreview)
  }
  private watchPreview(run: ActionRun) {
    this.previews.watch(run.id, run.previewUrl, (url) => {
      const entry = this.active.get(run.id)
      if (entry?.run.status !== 'running' || entry.run.previewUrl !== url) return
      entry.run = { ...entry.run, ready: true }
      this.scheduleMetadata(run.id)
    })
  }

  private persist(run: ActionRun) {
    const previous = this.metadataWrites.get(run.id) ?? Promise.resolve()
    const write = previous.catch(this.deps.reportError).then(() => this.deps.persistence.save(run))
    this.metadataWrites.set(run.id, write)
    void write
      .finally(() => {
        if (this.metadataWrites.get(run.id) === write) this.metadataWrites.delete(run.id)
      })
      .catch(this.deps.reportError)
    return write
  }
  private scheduleMetadata(runId: string) {
    if (this.timers.has(runId)) return
    this.timers.set(
      runId,
      setTimeout(() => {
        this.timers.delete(runId)
        const entry = this.active.get(runId)
        if (entry) void this.persist(entry.run).catch(this.deps.reportError)
      }, METADATA_FLUSH_MS),
    )
  }
  private finish(entry: LiveAction, exitCode: number | null, closeError?: string): Promise<void> {
    if (entry.finishing) return entry.finishing
    entry.finishing = (async () => {
      // Natural shell exit alone does not prove that all of its children stopped.
      await entry.process.stop()
      this.previews.cancel(entry.run.id)
      const finished: ActionRun = {
        ...entry.run,
        status:
          entry.run.status === 'stopping'
            ? 'stopped'
            : closeError !== undefined || exitCode !== 0
              ? 'failed'
              : 'completed',
        exitCode,
        finishedAt: Date.now(),
        ready: false,
        error: closeError ?? entry.run.error,
      }
      const timer = this.timers.get(finished.id)
      if (timer) clearTimeout(timer)
      this.timers.delete(finished.id)
      await this.deps.history.flush(historyKey(finished))
      await this.persist(finished)
      // Clients stop polling terminal runs. Publish completion only once it is durable.
      entry.run = finished
      this.active.delete(finished.id)
      entry.release()
    })().catch(async (error: unknown) => {
      // Keep ownership and liveness when cleanup cannot be proven. Stop remains retryable.
      entry.finishing = null
      entry.run = {
        ...entry.run,
        status: 'stopping',
        error: error instanceof Error ? error.message : String(error),
      }
      await this.persist(entry.run)
      throw error
    })
    return entry.finishing
  }
  private async stopEntry(entry: LiveAction) {
    if (entry.finishing) return entry.finishing
    this.previews.cancel(entry.run.id)
    entry.run = { ...entry.run, status: 'stopping', ready: false }
    await this.persist(entry.run)
    await entry.process.stop()
    // Native drain is a one-shot observation; tree shutdown is the retryable safety gate.
    let exitCode: number | null = null
    let closeError: string | undefined
    try {
      exitCode = (await entry.process.closed).exitCode
    } catch (error) {
      closeError = error instanceof Error ? error.message : String(error)
    }
    await this.finish(entry, exitCode, closeError)
  }
  private async persistTerminalStarting(entry: StartingAction) {
    if (!entry.terminalRun) return
    await this.persist(entry.terminalRun)
    entry.terminalPersisted = true
    this.starting.delete(entry.run.id)
  }
  private stopStarting(entry: StartingAction) {
    if (entry.stopPromise) return entry.stopPromise
    entry.cancelRequested = true
    entry.abort.abort()
    entry.stopPromise = (async () => {
      if (entry.terminalRun) {
        await this.persistTerminalStarting(entry)
        return
      }
      entry.run = { ...entry.run, status: 'stopping', ready: false }
      await this.persist(entry.run)
      await entry.settled
      const live = this.active.get(entry.run.id)
      if (live) {
        await this.stopEntry(live)
        return
      }
      if (entry.terminalRun) {
        // A concurrent Stop may have written `stopping` after launch persisted
        // its terminal result, or the launch's terminal write may have failed.
        await this.persistTerminalStarting(entry)
      }
    })().catch((error: unknown) => {
      entry.stopPromise = null
      throw error
    })
    return entry.stopPromise
  }
  private existing(workspaceId: string, actionId: string) {
    return [...this.active.values()].find(
      (entry) => entry.run.workspaceId === workspaceId && entry.run.action.id === actionId,
    )
  }
  private async reuse(input: StartManagedActionInput, entry: Pick<LiveAction, 'run'>) {
    await this.deps.persistence.recordRequest(
      input.workspace.workspaceId,
      input.actionId,
      input.requestId,
      entry.run.id,
    )
    return entry.run
  }
  private async requireRun(input: StartManagedActionInput, id: string) {
    const run = this.active.get(id)?.run ?? (await this.deps.persistence.get(id))
    if (!run || run.workspaceId !== input.workspace.workspaceId || run.action.id !== input.actionId)
      throw new Error('The selected run does not belong to this workspace action.')
    return run
  }
  private async stopRestartTarget(input: StartManagedActionInput) {
    if (!input.restartRunId) return
    await this.requireRun(input, input.restartRunId)
    const target = this.active.get(input.restartRunId)
    if (target) await this.stopEntry(target)
  }
  private launch(
    input: StartManagedActionInput,
    action: ActionDefinition,
    invocation: ActionRun['invocation'],
    environment: PreparedEnvironment,
  ) {
    return launchManagedAction(
      {
        deps: this.deps,
        active: this.active,
        starting: this.starting,
        persist: (run) => this.persist(run),
        watchPreview: (run) => this.watchPreview(run),
        finish: (entry, exitCode, closeError) => this.finish(entry, exitCode, closeError),
        stopEntry: (entry) => this.stopEntry(entry),
        scheduleMetadata: (runId) => this.scheduleMetadata(runId),
      },
      input,
      action,
      invocation,
      environment,
    )
  }
  start(input: StartManagedActionInput) {
    return enqueueProjectConfigWrite(
      `action-run:${input.workspace.workspaceId}:${input.actionId}`,
      async () => {
        const retried = await this.deps.persistence.findRequest(
          input.workspace.workspaceId,
          input.actionId,
          input.requestId,
        )
        if (retried) return this.active.get(retried.id)?.run ?? retried
        if (input.reuseRunId) {
          const run = await this.requireRun(input, input.reuseRunId)
          return this.reuse(input, { run })
        }
        const existing = this.existing(input.workspace.workspaceId, input.actionId)
        if (existing && !input.restartRunId && !existing.run.action.allowConcurrent)
          return this.reuse(input, existing)
        const { definition, invocation, environment } = await resolveManagedActionLaunch(
          input,
          this.deps,
        )
        await this.stopRestartTarget(input)
        const current = this.existing(input.workspace.workspaceId, input.actionId)
        if (current && (!definition.allowConcurrent || definition.kind === 'service'))
          return this.reuse(input, current)
        return this.launch(input, definition, invocation, environment)
      },
    )
  }
  async list(workspaceId: string) {
    return (await this.deps.persistence.list(workspaceId)).map(
      (run) => this.active.get(run.id)?.run ?? this.starting.get(run.id)?.terminalRun ?? run,
    )
  }
  async output(workspaceId: string, runId: string, afterOffset = 0) {
    if (!Number.isSafeInteger(afterOffset) || afterOffset < 0)
      throw new Error('Invalid action output cursor.')
    const current = this.active.get(runId)
    const run =
      current?.run ??
      this.starting.get(runId)?.terminalRun ??
      (await this.deps.persistence.get(runId))
    if (!run || run.workspaceId !== workspaceId)
      throw new Error('Action run not found in this workspace.')
    if (current) return actionOutputPage(run, current.output.toString(), afterOffset)
    const retained = await this.deps.history.readWithCursor(historyKey(run))
    return actionOutputPage(run, retained.text, afterOffset, retained.endOffset)
  }
  async stop(workspaceId: string, runId: string) {
    const entry = this.active.get(runId)
    const starting = this.starting.get(runId)
    const run = entry?.run ?? starting?.run ?? (await this.deps.persistence.get(runId))
    if (!run || run.workspaceId !== workspaceId)
      throw new Error('Action run not found in this workspace.')
    if (entry) await this.stopEntry(entry)
    if (!entry && starting) await this.stopStarting(starting)
    return starting?.terminalRun ?? (await this.deps.persistence.get(runId)) ?? run
  }
  async stopWorkspaceRuns(workspaceId: string) {
    for (const entry of [...this.starting.values()])
      if (entry.run.workspaceId === workspaceId) await this.stopStarting(entry)
    for (const entry of [...this.active.values()])
      if (entry.run.workspaceId === workspaceId) await this.stopEntry(entry)
  }
  async stopWorkspaceServices(workspaceId: string) {
    for (const entry of [...this.starting.values()])
      if (entry.run.workspaceId === workspaceId && entry.run.action.kind === 'service')
        await this.stopStarting(entry)
    const services = [...this.active.values()].filter(
      (entry) =>
        entry.run.workspaceId === workspaceId &&
        entry.run.action.kind === 'service' &&
        isActiveActionRun(entry.run),
    )
    for (const entry of services) await this.stopEntry(entry)
  }
  async shutdown() {
    for (const entry of [...this.starting.values()]) await this.stopStarting(entry)
    for (const entry of [...this.active.values()]) await this.stopEntry(entry)
    await this.deps.history.flush()
    await Promise.all(this.metadataWrites.values())
  }
}

export function createManagedActionRuns(deps: ManagedActionDependencies) {
  return new ManagedActionRuns(deps)
}
