import type { ChangeEvent, RefObject } from 'react'
import type { UseFileAttachmentResult } from '../hooks/useFileAttachment'

interface ComposerHiddenFileInputProps {
  readonly fileInputRef: RefObject<HTMLInputElement | null>
  readonly handleAttachFiles: UseFileAttachmentResult['handleAttachFiles']
}

export function ComposerHiddenFileInput({
  fileInputRef,
  handleAttachFiles,
}: ComposerHiddenFileInputProps) {
  function attachSelectedFiles(event: ChangeEvent<HTMLInputElement>) {
    void handleAttachFiles(event)
  }

  return (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      aria-label="Attach files"
      className="hidden"
      onChange={attachSelectedFiles}
    />
  )
}
