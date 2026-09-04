import type {
  WorkspaceExternalEditor,
  WorkspaceExternalEditorId,
} from '@shared/types/workspace-external-editor'
import type {
  WorkspaceContentMatch,
  WorkspaceDocumentApplyInput,
  WorkspaceDocumentApplyResult,
  WorkspaceEntryCreateInput,
  WorkspaceEntryMutationInput,
  WorkspaceEntryMutationResult,
  WorkspaceFileEntry,
  WorkspaceFilePage,
  WorkspaceFileReadResult,
  WorkspaceFileWriteInput,
  WorkspaceFileWriteResult,
  WorkspaceTextEncoding,
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
  readonly readFileWithEncoding: (input: {
    readonly projectPath: string
    readonly path: string
    readonly encoding: WorkspaceTextEncoding
  }) => EffectType<WorkspaceFileReadResult, WorkspaceFileError>
  readonly writeFile: (
    input: WorkspaceFileWriteInput,
  ) => EffectType<WorkspaceFileWriteResult, WorkspaceFileError>
  readonly applyDocumentEdits: (
    input: WorkspaceDocumentApplyInput,
  ) => EffectType<WorkspaceDocumentApplyResult, WorkspaceFileError>
  readonly listExternalEditors: () => EffectType<
    readonly WorkspaceExternalEditor[],
    WorkspaceFileError
  >
  readonly openFile: (input: {
    readonly projectPath: string
    readonly path: string
    readonly editor: WorkspaceExternalEditorId
    readonly line?: number
  }) => EffectType<void, WorkspaceFileError>
  readonly createEntry: (
    input: WorkspaceEntryCreateInput,
  ) => EffectType<WorkspaceEntryMutationResult, WorkspaceFileError>
  readonly moveEntry: (
    input: WorkspaceEntryMutationInput,
  ) => EffectType<WorkspaceEntryMutationResult, WorkspaceFileError>
  readonly duplicateEntry: (
    input: WorkspaceEntryMutationInput,
  ) => EffectType<WorkspaceEntryMutationResult, WorkspaceFileError>
  readonly trashEntry: (
    input: WorkspaceEntryMutationInput,
  ) => EffectType<WorkspaceEntryMutationResult, WorkspaceFileError>
  readonly revealEntry: (input: {
    readonly projectPath: string
    readonly path: string
  }) => EffectType<void, WorkspaceFileError>
  readonly readPage: (input: {
    readonly projectPath: string
    readonly path: string
    readonly offset: number
    readonly limit: number
  }) => EffectType<WorkspaceFilePage, WorkspaceFileError>
}

export class WorkspaceFileService extends Context.Tag('@openwaggle/WorkspaceFileService')<
  WorkspaceFileService,
  WorkspaceFileServiceShape
>() {}
