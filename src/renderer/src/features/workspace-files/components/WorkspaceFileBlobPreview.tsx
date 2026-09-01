import type { WorkspaceBinaryFileReadResult } from '@shared/types/workspace-files'
import { useEffect, useRef } from 'react'

function useBlobPreviewSource<Element extends HTMLImageElement | HTMLIFrameElement>(
  file: WorkspaceBinaryFileReadResult,
) {
  const previewRef = useRef<Element>(null)

  useEffect(() => {
    const buffer = new ArrayBuffer(file.data.byteLength)
    new Uint8Array(buffer).set(file.data)
    const url = URL.createObjectURL(new Blob([buffer], { type: file.mimeType }))
    const element = previewRef.current
    if (element) element.src = url

    return () => {
      element?.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [file])

  return previewRef
}

function BlobImagePreview({ file }: { readonly file: WorkspaceBinaryFileReadResult }) {
  const previewRef = useBlobPreviewSource<HTMLImageElement>(file)

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[radial-gradient(circle_at_center,var(--color-bg-hover)_1px,transparent_1px)] bg-size-(--preview-grid-size) p-6 [--preview-grid-size:1rem_1rem]">
      <img ref={previewRef} alt={file.basename} className="max-h-full max-w-full object-contain" />
    </div>
  )
}

function BlobPdfPreview({ file }: { readonly file: WorkspaceBinaryFileReadResult }) {
  const previewRef = useBlobPreviewSource<HTMLIFrameElement>(file)

  return (
    <iframe
      ref={previewRef}
      title={file.basename}
      sandbox=""
      className="min-h-0 flex-1 border-0 bg-text-primary"
    />
  )
}

export function WorkspaceFileBlobPreview({
  file,
}: {
  readonly file: WorkspaceBinaryFileReadResult
}) {
  if (file.previewKind === 'image') {
    return <BlobImagePreview file={file} />
  }
  return <BlobPdfPreview file={file} />
}
