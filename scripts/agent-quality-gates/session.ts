/**
 * The agent turn-end quality gate, kept apart from Pi so it can be tested. When a run is about to
 * settle, Fallow and React Doctor check the files the run changed; findings go back to the agent
 * as a follow-up message and the run continues so it can fix them. Clean runs, runs that changed
 * no source files, and failed or aborted runs stay silent. After `MAX_FEEDBACK_ROUNDS` follow-ups
 * in one run the gate lets it settle, so a finding the agent cannot fix never loops; `check` and
 * CI still fail on it.
 */
import { type WorkspaceSnapshot, changedFiles, takeSnapshot } from './changed-files'
import { type Finding, feedbackMessage } from './findings'
import { qualityGateFindings } from './gates'
import { type RunProcess, runProcess } from './process'

export const QUALITY_GATES_MESSAGE_TYPE = 'openwaggle-quality-gates'
export const MAX_FEEDBACK_ROUNDS = 3

export interface SettleState {
  readonly outcome: 'completed' | 'aborted' | 'error'
  readonly canContinue: boolean
}

export interface Feedback {
  readonly content: string
  readonly findings: readonly Finding[]
}

export interface QualityGateDependencies {
  readonly run?: RunProcess
  readonly findings?: typeof qualityGateFindings
}

function isAborted(signal: AbortSignal | undefined) {
  return signal?.aborted === true
}

export class QualityGateSession {
  private snapshot: Promise<WorkspaceSnapshot | undefined> | undefined = undefined
  private rounds = 0
  private readonly run: RunProcess
  private readonly findings: typeof qualityGateFindings

  constructor(dependencies: QualityGateDependencies = {}) {
    this.run = dependencies.run ?? runProcess
    this.findings = dependencies.findings ?? qualityGateFindings
  }

  /**
   * A run started; the first run since the last settlement records where the files stood. Await
   * it before the run's first tool call, so an early edit is not mistaken for a prior change.
   */
  async start(cwd: string) {
    this.snapshot ??= takeSnapshot(this.run, cwd).catch(() => undefined)
    await this.snapshot
  }

  /** The follow-up for a run about to settle, or undefined when there is nothing to fix. */
  async beforeSettle(state: SettleState, signal?: AbortSignal): Promise<Feedback | undefined> {
    if (state.outcome !== 'completed' || !state.canContinue || this.rounds >= MAX_FEEDBACK_ROUNDS) {
      return undefined
    }
    const snapshot = await this.snapshot
    if (snapshot === undefined) {
      return undefined
    }
    const files = await changedFiles(this.run, snapshot)
    if (files.length === 0 || isAborted(signal)) {
      return undefined
    }
    const findings = await this.findings({
      root: snapshot.root,
      files,
      run: this.run,
      ...(signal === undefined ? {} : { signal }),
    })
    // An abort during the tool runs leaves partial reports; report nothing rather than guess.
    if (findings.length === 0 || isAborted(signal)) {
      return undefined
    }
    this.rounds += 1
    return { content: feedbackMessage(findings), findings }
  }

  /** The run settled: the next prompt starts a new snapshot and a new round budget. */
  settled() {
    this.snapshot = undefined
    this.rounds = 0
  }
}
