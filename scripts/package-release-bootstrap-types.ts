export interface BootstrapCommandRequest {
  readonly args: readonly string[]
  readonly command: string
  readonly cwd?: string
  readonly input?: string
  readonly interactive?: boolean
  readonly mutates?: boolean
}

export interface BootstrapCommandResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

export interface BootstrapCommandRunner {
  run(request: BootstrapCommandRequest): Promise<BootstrapCommandResult>
}

export interface BootstrapFileSystem {
  makeTempDirectory(prefix: string): Promise<string>
  removeDirectory(directory: string): Promise<void>
  writeFile(filePath: string, contents: string): Promise<void>
}

export interface BootstrapInterruptions {
  protect<T>(operation: () => Promise<T>): Promise<T>
}

export interface BootstrapDependencies {
  readonly commands: BootstrapCommandRunner
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly files: BootstrapFileSystem
  readonly interruptions: BootstrapInterruptions
  readonly writeLine: (line: string) => void
}

export interface BootstrapPackageProgress {
  readonly name: string
  readonly nextAction: string
  readonly state: 'pending' | 'compatible' | 'conflict' | 'complete'
}

export interface BootstrapGithubProgress {
  readonly environment: 'pending' | 'compatible' | 'conflict' | 'complete'
  readonly ruleset: 'pending' | 'compatible' | 'conflict' | 'complete'
}

export interface PackageReleaseBootstrapResult {
  readonly blockers: readonly string[]
  readonly github: BootstrapGithubProgress
  readonly mode: 'preflight' | 'execute'
  readonly nextAction: string
  readonly ok: boolean
  readonly packages: readonly BootstrapPackageProgress[]
}

export interface PackageReleaseBootstrapInput {
  readonly args: readonly string[]
  readonly projectRoot: string
}

export interface MutablePackageProgress {
  name: string
  nextAction: string
  state: BootstrapPackageProgress['state']
}

export const NEXT_PUBLISH = 'publish bootstrap placeholder'
export const NEXT_CONFIGURE = 'configure trusted publisher and finalize bootstrap'
export const NEXT_FINALIZE = 'finalize bootstrap security settings'
export const NEXT_REASSERT_MFA = 'reassert unverifiable package MFA setting'
export const NEXT_REMOVE_LATEST_AND_CONFIGURE =
  'remove automatic bootstrap latest tag, then configure trusted publisher'
export const NEXT_REMOVE_LATEST_AND_FINALIZE =
  'remove automatic bootstrap latest tag, then finalize security settings'
export const NEXT_REMOVE_LATEST_AND_REASSERT_MFA =
  'remove automatic bootstrap latest tag, then reassert package MFA'

export const AUTOMATIC_LATEST_REPAIR_BY_CONTINUATION = new Map([
  [NEXT_CONFIGURE, NEXT_REMOVE_LATEST_AND_CONFIGURE],
  [NEXT_FINALIZE, NEXT_REMOVE_LATEST_AND_FINALIZE],
  [NEXT_REASSERT_MFA, NEXT_REMOVE_LATEST_AND_REASSERT_MFA],
])

export const CONTINUATION_BY_AUTOMATIC_LATEST_REPAIR = new Map([
  [NEXT_REMOVE_LATEST_AND_CONFIGURE, NEXT_CONFIGURE],
  [NEXT_REMOVE_LATEST_AND_FINALIZE, NEXT_FINALIZE],
  [NEXT_REMOVE_LATEST_AND_REASSERT_MFA, NEXT_REASSERT_MFA],
])
