import { launchApp, type LaunchedApp, type PerfApp } from './perf-app'
import { type PerfProfile, profileEnvironment } from './perf-profile'

export interface CliRunOptions {
  readonly prompt: string
  readonly model: string
  readonly yolo?: boolean
  readonly jsonl?: boolean
  readonly title?: string
  readonly environment?: Readonly<Record<string, string>>
  readonly projectPath?: string
}

export interface CliRun {
  readonly launched: LaunchedApp
  /** Resolves with the exit code once the Run settled and the command exited. */
  readonly exited: Promise<number | null>
}

/**
 * `openwaggle run` against the profile's Session Host (it starts one when none runs): a new
 * Session with one Run, as a user starts it from a terminal.
 */
export function startCliRun(app: PerfApp, profile: PerfProfile, options: CliRunOptions): CliRun {
  const launched = launchApp(app, profileEnvironment(profile, options.environment), [
    '--use-mock-keychain',
    'run',
    '--project',
    options.projectPath ?? profile.projectPath,
    '--model',
    options.model,
    ...(options.yolo ? ['--yolo'] : []),
    ...(options.jsonl ? ['--jsonl'] : []),
    ...(options.title ? ['--title', options.title] : []),
    '--text',
    options.prompt,
  ])
  const exited = new Promise<number | null>((resolve) => launched.child.once('exit', resolve))
  return { launched, exited }
}
