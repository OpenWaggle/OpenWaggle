import type { WorkspaceTextFileReadResult } from '@shared/types/workspace-files'

export const workspaceTextFileFixture: WorkspaceTextFileReadResult = {
  path: 'src/example.ts',
  basename: 'example.ts',
  size: 24,
  modifiedAt: 1,
  revision: 'revision-1',
  mimeType: 'text/typescript',
  previewKind: 'text',
  content: 'first line\nsecond line\n',
  language: 'typescript',
  documentVersion: 0,
  fidelity: {
    encoding: 'utf-8',
    lineEnding: 'lf',
    finalNewline: true,
    indentStyle: 'space',
    indentSize: 2,
    editorConfigApplied: false,
  },
}
