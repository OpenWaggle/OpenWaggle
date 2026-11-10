/**
 * The agent gate for one Pi Session, kept apart from Pi so it can be tested. It records what each
 * tool call changed (from git snapshots around shell and script calls, from the path for edit and
 * write calls), asks the user when a change needs their approval, and when the agent is about to
 * stop runs the gate on the files changed since the last passing gate.
 */
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { SessionActivity } from './activity'
import { type Baseline, captureBaseline } from './baseline'
import { type CommandRun, bashRun } from './commands'
import { type FetchLatest, dependencyCheck } from './dependencies'
import { type GatePlugin, runGate } from './gate'
import { type GateDecision, type LoopState, decide, nextLoopState } from './report'
import { type RunProcess, runProcess } from './run-process'
import { type WorkspaceSnapshot, changesBetween, repositoryRoot, takeSnapshot } from './snapshot'
import type { LintRunner } from './tool-checks'
import { typecheckProjects, typeErrorKey } from './typecheck'
import { type ApprovalAsk, Approvals } from './approvals'

export interface ToolCall {
  readonly id: string
  readonly parentId?: string
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
}

export interface ToolResult extends ToolCall {
  readonly isError: boolean
  readonly structuredContent?: unknown
}

export interface SettleState {
  readonly outcome: 'completed' | 'aborted' | 'error'
  readonly canContinue: boolean
}

export interface AgentGateOptions {
  readonly run?: RunProcess
  readonly runner?: LintRunner
  readonly ask?: ApprovalAsk
  readonly plugins?: readonly GatePlugin[]
  readonly latest?: FetchLatest
}

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
  private loop: LoopState = { blocked: undefined, handedOff: undefined }
  private readonly run: RunProcess
  private readonly approvals: Approvals

  constructor(private readonly options: AgentGateOptions = {}) {
    this.run = options.run ?? runProcess
    this.approvals = new Approvals(options.ask)
  }

  /** The Session started: record the baseline. Outside a git repository the gate stays off. */
  async start(cwd: string) {
    this.cwd = cwd
    this.root = await repositoryRoot(this.run, cwd)
    if (this.root === undefined) return
    this.snapshot = await takeSnapshot(this.run, this.root)
    if (this.snapshot !== undefined)
      this.baseline = await captureBaseline(this.run, this.root, this.snapshot)
  }

  /** A user prompt; naming a package in one approves adding it. */
  notePrompt(text: string) {
    this.approvals.notePrompt(text)
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

  /** Records what the call changed; returns a note for the tool result when the user said no. */
  async afterTool(result: ToolResult): Promise<string | undefined> {
    const root = this.root
    if (root === undefined || this.baseline === undefined) return undefined
    const commandRun = SHELL_TOOLS.has(result.name)
      ? bashRun(result.input, result.structuredContent, result.isError)
      : undefined
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
    return changed.length === 0 ? undefined : this.approvals.review(root, changed, this.baseline)
  }

  async settle(state: SettleState, signal?: AbortSignal): Promise<GateDecision | undefined> {
    const root = this.root
    const baseline = this.baseline
    if (root === undefined || baseline === undefined || state.outcome !== 'completed')
      return undefined
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
      sessionFiles: [...this.activity.sessionFiles],
      tsconfigApproved: (file, weakenings) => this.approvals.tsconfigApproved(file, weakenings),
      dependencies: dependencyCheck({
        approved: (pin) => this.approvals.dependencyApproved(pin),
        ...(this.options.latest === undefined ? {} : { latest: this.options.latest }),
      }),
      ...(this.options.plugins === undefined ? {} : { plugins: this.options.plugins }),
      ...(signal === undefined ? {} : { signal }),
    })
    if (signal?.aborted === true) return undefined
    const decision = decide(verdict.findings, verdict.failures, this.loop, state.canContinue)
    this.loop = nextLoopState(this.loop, decision)
    if (decision.kind === 'pass')
      this.activity.passed(verdict.failures.flatMap((failure) => failure.files))
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
    )
      return []
    const after = await takeSnapshot(this.run, root)
    if (after === undefined) return []
    const changed = await changesBetween(this.run, root, this.snapshot, after)
    this.snapshot = after
    return changed
  }
}
