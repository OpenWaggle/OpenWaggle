import type {
  WorkspaceContentMatch,
  WorkspaceFileEntry,
  WorkspaceFileReadResult,
  WorkspaceFileWriteInput,
  WorkspaceFileWriteResult,
} from '@shared/types/workspace-files'
import { Context } from 'effect'
import type { Effect as EffectType } from 'effect/Effect'
import type { WorkspaceFileError } from '../errors'

export interface WorkspaceFileServiceShape {
  readonly searchFiles: (input: {
    readonly projectPath: string
    readonly query: string
    readonly limit: number
  }) => EffectType<readonly WorkspaceFileEntry[], WorkspaceFileError>
  readonly searchContent: (input: {
    readonly projectPath: string
    readonly query: string
    readonly limit: number
  }) => EffectType<readonly WorkspaceContentMatch[], WorkspaceFileError>
  readonly cancelContentSearch: (input: {
    readonly projectPath: string
  }) => EffectType<void, WorkspaceFileError>
  readonly readFile: (input: {
    readonly projectPath: string
    readonly path: string
  }) => EffectType<WorkspaceFileReadResult, WorkspaceFileError>
  readonly writeFile: (
    input: WorkspaceFileWriteInput,
  ) => EffectType<WorkspaceFileWriteResult, WorkspaceFileError>
  readonly openFile: (input: {
    readonly projectPath: string
    readonly path: string
  }) => EffectType<void, WorkspaceFileError>
}

export class WorkspaceFileService extends Context.Tag('@openwaggle/WorkspaceFileService')<
  WorkspaceFileService,
  WorkspaceFileServiceShape
>() {}
