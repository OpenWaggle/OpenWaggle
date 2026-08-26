import type {
  WorkspaceBinaryFileReadResult,
  WorkspaceFileReadResult,
  WorkspaceUnavailableFileReadResult,
} from '@shared/types/workspace-files'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, FolderTree, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { workspaceFileQueryOptions } from '@/queries/workspace-files'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import { WorkspaceFileBrowser } from './WorkspaceFileBrowser'
import { WorkspaceFileEditor } from './WorkspaceFileEditor'

function BlobPreview({ file }: { readonly file: WorkspaceBinaryFileReadResult }) {
  const [url] = useState(() => {
    const buffer = new ArrayBuffer(file.data.byteLength)
    new Uint8Array(buffer).set(file.data)
    return URL.createObjectURL(new Blob([buffer], { type: file.mimeType }))
  })

  useEffect(() => () => URL.revokeObjectURL(url), [url])

  if (file.previewKind === 'image') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[radial-gradient(circle_at_center,var(--color-bg-hover)_1px,transparent_1px)] bg-size-(--preview-grid-size) p-6 [--preview-grid-size:1rem_1rem]">
        <img src={url} alt={file.basename} className="max-h-full max-w-full object-contain" />
      </div>
    )
  }
  return (
    <iframe
      title={file.basename}
      src={url}
      sandbox=""
      className="min-h-0 flex-1 border-0 bg-text-primary"
    />
  )
}

function UnavailablePreview({ file }: { readonly file: WorkspaceUnavailableFileReadResult }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-text-secondary">Preview unavailable</p>
      <p className="max-w-sm text-xs leading-5 text-text-tertiary">{file.reason}</p>
    </div>
  )
}

function FilePreviewContent({
  file,
  projectPath,
  line,
}: {
  readonly file: WorkspaceFileReadResult | undefined
  readonly projectPath: string | null
  readonly line: number | null
}) {
  if (!projectPath) return <PanelMessage text="Open a project to read this file." />
  if (!file) return <PanelMessage text="File unavailable." error />
  if (
    file.previewKind === 'text' ||
    file.previewKind === 'markdown' ||
    file.previewKind === 'html'
  ) {
    return (
      <WorkspaceFileEditor
        key={file.path}
        projectPath={projectPath}
        file={file}
        targetLine={line}
      />
    )
  }
  if (file.previewKind === 'image' || file.previewKind === 'pdf') {
    return <BlobPreview key={file.revision} file={file} />
  }
  if (file.previewKind === 'binary' || file.previewKind === 'oversized') {
    return <UnavailablePreview file={file} />
  }
  return null
}

export function WorkspaceFilePanel({
  projectPath,
  relativePath,
  line,
  onClose,
  onOpenFile,
}: {
  readonly projectPath: string | null
  readonly relativePath: string
  readonly line: number | null
  readonly onClose: () => void
  readonly onOpenFile: (path: string, line?: number | null) => void
}) {
  const [explorerOpen, setExplorerOpen] = useState(true)
  const showToast = useUIStore((state) => state.showToast)
  const fileQuery = useQuery(workspaceFileQueryOptions(projectPath, relativePath))
  const file = fileQuery.data

  return (
    <div className="flex size-full min-h-0 flex-col bg-bg">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-2">
        <Button
          variant={explorerOpen ? 'accent' : 'ghost'}
          size="icon-sm"
          aria-label="Toggle file explorer"
          title="Toggle file explorer"
          onClick={() => setExplorerOpen((current) => !current)}
        >
          <FolderTree className="size-3.5" />
        </Button>
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary"
          title={relativePath}
        >
          {relativePath}
          {line ? <span className="text-accent">:{line}</span> : null}
        </span>
        {projectPath && (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Open in default editor"
            aria-label="Open file in default editor"
            onClick={() => {
              void api.openWorkspaceFileExternal(projectPath, relativePath).catch((error) => {
                showToast(error instanceof Error ? error.message : String(error), 'error')
              })
            }}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          title="Close file panel"
          aria-label="Close file panel"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {explorerOpen && projectPath && (
          <WorkspaceFileBrowser
            projectPath={projectPath}
            currentPath={relativePath}
            onOpenFile={onOpenFile}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {fileQuery.isLoading ? (
            <PanelMessage text="Loading file…" />
          ) : fileQuery.error ? (
            <PanelMessage text={fileQuery.error.message} error />
          ) : (
            <FilePreviewContent file={file} projectPath={projectPath} line={line} />
          )}
        </div>
      </div>
    </div>
  )
}

function PanelMessage({
  text,
  error = false,
}: {
  readonly text: string
  readonly error?: boolean
}) {
  return (
    <output
      className={`flex min-h-0 flex-1 items-center justify-center p-8 text-center text-xs ${
        error ? 'text-error' : 'text-text-tertiary'
      }`}
    >
      {text}
    </output>
  )
}
