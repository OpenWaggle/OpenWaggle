/**
 * The agent gate for one Pi Session, kept apart from Pi so it can be tested. It records what each
 * tool call changed (content hashes of the dirty files around shell and script calls, from the
 * path for edit and write calls), and when the agent is about to stop runs the gate on the files
 * changed since the last passing gate. It never asks the user anything: findings go back to the
 * agent, and when the loop guard gives up the run ends without a message.
 */
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { SessionActivity } from './activity'
import { type Baseline, captureBaseline } from './baseline'
import { type CommandRun, bashRun } from './commands'
import { type GatePlugin, runGate } from './gate'
import { type GateDecision, type LoopState, decide, nextLoopState } from './report'
import {
  type WorkspaceSnapshot,
  changedFiles,
  takeSnapshot,
} from '../agent-quality-gates/changed-files'
import { type RunProcess, runProcess } from '../agent-quality-gates/process'
import { repositoryRoot } from './git'
import type { LintRunner } from './tool-checks'
import { typecheckProjects, typeErrorKey } from './typecheck'

export interface ToolCall {
  readonly id: string
  readonly parentId?: string
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
}

export interface ToolResult extends ToolCall {
  readonly isError: boolean
}

export interface SettleState {
  readonly outcome: 'completed' | 'aborted' | 'error'
  readonly canContinue: boolean
}

export interface AgentGateOptions {
  readonly run?: RunProcess
  readonly runner?: LintRunner
  readonly plugins?: readonly GatePlugin[]
}

/**
 * Continuations one run may get. The loop guard ends a repeated set after one; this bounds a run
 * whose set keeps changing.
 */
export const MAX_FEEDBACK_ROUNDS = 3
const PATH_TOOLS = new Set(['edit', 'write'])
const SHELL_TOOLS = new Set(['bash', 'powershell'])
/** Tools that never change files in the checkout; no snapshot around them. */
const READ_ONLY_TOOLS = new Set([
  'read',
  'grep',
  'find',
  'ls',
  'tool_search',
  'hive',
  'openwaggle_docs',
])

interface InFlight {
  readonly name: string
  readonly commands: CommandRun[]
}

export class AgentGateSession {
  private root: string | undefined = undefined
  private cwd = ''
  private baseline: Baseline | undefined = undefined
  private snapshot: WorkspaceSnapshot | undefined = undefined
  private readonly inFlight = new Map<string, InFlight>()
  private typeBaseline: Promise<ReadonlySet<string> | undefined> | undefined = undefined
  private readonly activity = new SessionActivity()
  private loop: LoopState = { blocked: undefined, given: undefined }
  private rounds = 0
  private readonly run: RunProcess

  private readonly options: AgentGateOptions

  constructor(options: AgentGateOptions = {}) {
    this.options = options
    this.run = options.run ?? runProcess
  }

  /** The Session started: record the baseline. Outside a git repository the gate stays off. */
  async start(cwd: string) {
    this.cwd = cwd
    this.root = await repositoryRoot(this.run, cwd)
    if (this.root === undefined) return
    this.snapshot = await takeSnapshot(this.run, this.root)
    if (this.snapshot === undefined) return
    this.baseline = await captureBaseline(this.run, this.root, this.snapshot)
    // In the background: by the agent's first change it has usually finished.
    this.typeBaseline = typecheckProjects(this.run, this.root, ['node', 'web']).then((result) =>
      result.failures.length > 0 ? undefined : new Set(result.errors.map(typeErrorKey)),
    )
  }

  /** The run settled; the next run gets a new round budget. */
  settled() {
    this.rounds = 0
  }

  async beforeTool(call: ToolCall) {
    if (this.root === undefined || call.parentId !== undefined || this.readOnly(call.name)) return
    // The type-check baseline must not see the agent's first change.
    await this.typeBaseline
    if (PATH_TOOLS.has(call.name)) return
    if (this.inFlight.size === 0) {
      this.snapshot = (await takeSnapshot(this.run, this.root)) ?? this.snapshot
    }
    this.inFlight.set(call.id, { name: call.name, commands: [] })
  }

  /** Records what the call changed. */
  async afterTool(result: ToolResult): Promise<void> {
    const root = this.root
    if (root === undefined || this.baseline === undefined) return
    const commandRun = SHELL_TOOLS.has(result.name) ? bashRun(result.input) : undefined
    const parent = result.parentId === undefined ? undefined : this.inFlight.get(result.parentId)
    if (parent !== undefined && commandRun !== undefined) parent.commands.push(commandRun)
    const changed = await this.changedBy(root, result)
    const own = this.inFlight.get(result.id)
    this.inFlight.delete(result.id)
    const runs = [
      ...(own?.commands ?? []),
      ...(commandRun === undefined || parent !== undefined ? [] : [commandRun]),
    ]
    this.activity.recordChanges(changed, {
      tool: result.name,
      commands: runs.map((run) => run.command),
    })
    this.activity.recordCommands(runs)
  }

  async settle(state: SettleState, signal?: AbortSignal): Promise<GateDecision | undefined> {
    const root = this.root
    const baseline = this.baseline
    if (root === undefined || baseline === undefined || state.outcome !== 'completed') {
      return undefined
    }
    const sessionFindings = this.activity.findings()
    if (this.activity.pending.size === 0 && sessionFindings.length === 0) return undefined
    const verdict = await runGate({
      root,
      files: [...this.activity.pending].sort(),
      baseline,
      run: this.run,
      runner: this.options.runner ?? 'oxlint',
      sessionFindings,
      typeBaseline: () => this.typeBaseline ?? Promise.resolve(undefined),
      ...(this.options.plugins === undefined ? {} : { plugins: this.options.plugins }),
      ...(signal === undefined ? {} : { signal }),
    })
    if (signal?.aborted === true) return undefined
    const canContinue = state.canContinue && this.rounds < MAX_FEEDBACK_ROUNDS
    const decision = decide(verdict.findings, this.loop, canContinue)
    if (decision.kind === 'block') this.rounds += 1
    this.loop = nextLoopState(this.loop, decision)
    if (decision.kind === 'pass') {
      this.activity.passed(verdict.failures.flatMap((failure) => failure.files))
    }
    return decision
  }

  private readOnly(name: string) {
    return READ_ONLY_TOOLS.has(name) || name.startsWith('mcp__')
  }

  private async changedBy(root: string, result: ToolResult) {
    const target = result.input['path']
    if (PATH_TOOLS.has(result.name)) {
      if (result.isError || typeof target !== 'string') return []
      const absolute = path.resolve(this.cwd || root, target)
      // The repository root is a real path; the tool's path may go through a symlink.
      const directory = await realpath(path.dirname(absolute)).catch(() => path.dirname(absolute))
      const relative = path
        .relative(root, path.join(directory, path.basename(absolute)))
        .split(path.sep)
        .join('/')
      return relative.startsWith('..') ? [] : [relative]
    }
    if (
      result.parentId !== undefined ||
      !this.inFlight.has(result.id) ||
      this.snapshot === undefined
    ) {
      return []
    }
    // Content hashes against the snapshot before the call: a shell edit counts, a touch does not.
    const changed = await changedFiles(this.run, this.snapshot)
    // Only an overlapping call still measures from the old snapshot; the next call takes its own.
    if (this.inFlight.size > 1 && changed.length > 0) {
      this.snapshot = (await takeSnapshot(this.run, root)) ?? this.snapshot
    }
    return changed
  }
}
