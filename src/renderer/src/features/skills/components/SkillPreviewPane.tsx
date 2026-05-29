import type { SkillDiscoveryItem } from '@shared/types/standards'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { safeMarkdownComponents } from '@/shared/lib/markdown-link-components'
import { safeMarkdownRehypePlugins, safeMarkdownUrlTransform } from '@/shared/lib/markdown-safety'
import { Spinner } from '@/shared/ui/Spinner'

interface SkillPreviewPaneProps {
  readonly error: string | null
  readonly selectedSkill: SkillDiscoveryItem | null
  readonly isPreviewLoading: boolean
  readonly previewMarkdown: string
}

export function SkillPreviewPane({
  error,
  selectedSkill,
  isPreviewLoading,
  previewMarkdown,
}: SkillPreviewPaneProps) {
  return (
    <div className="min-h-0 overflow-y-auto px-5 py-4">
      {error && (
        <div className="mb-3 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-[12px] text-error">
          {error}
        </div>
      )}
      <SkillPreviewContent
        selectedSkill={selectedSkill}
        isPreviewLoading={isPreviewLoading}
        previewMarkdown={previewMarkdown}
      />
    </div>
  )
}

function SkillPreviewContent({
  selectedSkill,
  isPreviewLoading,
  previewMarkdown,
}: Omit<SkillPreviewPaneProps, 'error'>) {
  if (!selectedSkill) {
    return (
      <div className="rounded-lg border border-border bg-bg-secondary p-4 text-[13px] text-text-tertiary">
        Select a skill to preview its instructions.
      </div>
    )
  }

  if (selectedSkill.loadStatus === 'error') {
    return (
      <div className="rounded-lg border border-error/30 bg-error/10 p-4 text-[13px] text-error">
        {selectedSkill.loadError ?? 'This skill file is invalid.'}
      </div>
    )
  }

  if (isPreviewLoading) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
        <Spinner />
        Loading preview…
      </div>
    )
  }

  return <SkillPreviewMarkdown previewMarkdown={previewMarkdown} />
}

function SkillPreviewMarkdown({ previewMarkdown }: { readonly previewMarkdown: string }) {
  return (
    <article className="prose max-w-none text-[13px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={safeMarkdownRehypePlugins}
        urlTransform={safeMarkdownUrlTransform}
        components={safeMarkdownComponents}
      >
        {previewMarkdown}
      </ReactMarkdown>
    </article>
  )
}
