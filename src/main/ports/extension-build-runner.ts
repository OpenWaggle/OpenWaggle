import { Context } from 'effect'
import type { Effect as EffectType } from 'effect/Effect'
import type { ExtensionBuildRunnerError } from '../errors'

export interface RunExtensionBuildInput {
  readonly packagePath: string
  readonly command: string
}

export interface ExtensionBuildRunResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

export interface ExtensionBuildRunnerShape {
  readonly run: (
    input: RunExtensionBuildInput,
  ) => EffectType<ExtensionBuildRunResult, ExtensionBuildRunnerError>
}

export class ExtensionBuildRunner extends Context.Tag('@openwaggle/ExtensionBuildRunner')<
  ExtensionBuildRunner,
  ExtensionBuildRunnerShape
>() {}
