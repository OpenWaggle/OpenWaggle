import { WORKSPACE_EDITOR_PERFORMANCE } from '@shared/constants/workspace-editor-performance'
import type {
  WorkspaceFilePage,
  WorkspaceFileReadResult,
  WorkspaceUnavailableFileReadResult,
} from '@shared/types/workspace-files'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { workspaceFileQueryOptions } from '@/queries/workspace-files'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { SourceView } from '@/shared/ui/SourceView'
import { WorkspaceFileBlobPreview } from './WorkspaceFileBlobPreview'
import { WorkspaceFileEditor } from './WorkspaceFileEditor'

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

function UnavailablePreview({ file }: { readonly file: WorkspaceUnavailableFileReadResult }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-text-secondary">Preview unavailable</p>
      <p className="max-w-sm text-xs leading-5 text-text-tertiary">{file.reason}</p>
    </div>
  )
}

function PagedSourceToolbar({
  file,
  page,
  loading,
  onLoadPage,
}: {
  readonly file: WorkspaceUnavailableFileReadResult
  readonly page: WorkspaceFilePage | null
  readonly loading: boolean
  readonly onLoadPage: (offset: number) => void
}) {
  const previousOffset = Math.max(
    0,
    (page?.offset ?? 0) - WORKSPACE_EDITOR_PERFORMANCE.SOURCE_PAGE_REQUEST_BYTES,
  )
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-bg-secondary px-3 py-2">
      <div className="min-w-0 text-xs text-text-muted">
        <p className="truncate">Paged source view · {file.reason}</p>
        {page ? (
          <p className="mt-0.5 font-mono">
            Bytes {page.offset.toLocaleString()}–{page.endOffset.toLocaleString()} of{' '}
            {page.size.toLocaleString()} · {page.encoding}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          size="xs"
          variant="ghost"
          disabled={!page || page.offset === 0 || loading}
          onClick={() => onLoadPage(previousOffset)}
        >
          Previous
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={!page?.nextOffset || loading}
          onClick={() => onLoadPage(page?.nextOffset ?? 0)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

function OversizedSourcePreview({
  file,
  projectPath,
}: {
  readonly file: WorkspaceUnavailableFileReadResult
  readonly projectPath: string
}) {
  const [page, setPage] = useState<WorkspaceFilePage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadPage(offset: number) {
    setLoading(true)
    setError(null)
    try {
      setPage(
        await api.readWorkspaceFilePage(
          projectPath,
          file.path,
          offset,
          WORKSPACE_EDITOR_PERFORMANCE.SOURCE_PAGE_REQUEST_BYTES,
        ),
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void api
      .readWorkspaceFilePage(
        projectPath,
        file.path,
        0,
        WORKSPACE_EDITOR_PERFORMANCE.SOURCE_PAGE_REQUEST_BYTES,
      )
      .then(
        (nextPage) => {
          if (active) setPage(nextPage)
        },
        (loadError: unknown) => {
          if (active) setError(loadError instanceof Error ? loadError.message : String(loadError))
        },
      )
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [file.path, projectPath])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PagedSourceToolbar
        file={file}
        page={page}
        loading={loading}
        onLoadPage={(offset) => void loadPage(offset)}
      />
      {error ? (
        <p className="border-b border-error/30 bg-error/10 p-2 text-xs text-error">{error}</p>
      ) : null}
      {page ? (
        <SourceView
          source={page.content}
          language={page.language ?? file.language}
          path={file.path}
          className="min-h-0 flex-1"
          ariaLabel={`Paged source for ${file.path}`}
        />
      ) : (
        <PanelMessage text={loading ? 'Loading source page…' : 'Source page unavailable.'} />
      )}
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
    return <WorkspaceFileBlobPreview key={file.revision} file={file} />
  }
  if (file.previewKind === 'oversized') {
    return <OversizedSourcePreview file={file} projectPath={projectPath} />
  }
  if (file.previewKind === 'binary') return <UnavailablePreview file={file} />
  return null
}

export function WorkspaceFilePane({
  projectPath,
  relativePath,
  line,
}: {
  readonly projectPath: string | null
  readonly relativePath: string
  readonly line: number | null
}) {
  const fileQuery = useQuery(workspaceFileQueryOptions(projectPath, relativePath))
  if (fileQuery.isLoading) return <PanelMessage text="Loading file…" />
  if (fileQuery.error) return <PanelMessage text={fileQuery.error.message} error />
  return <FilePreviewContent file={fileQuery.data} projectPath={projectPath} line={line} />
}
