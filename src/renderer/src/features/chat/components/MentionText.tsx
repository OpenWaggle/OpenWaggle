import { FileText, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { useOpenWorkspaceFile } from '@/features/workspace-files/hooks'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

const ICON_SIZE = 12

/**
 * Matches composer references at a word boundary. File references accept paths;
 * skill references use the same identifier grammar as runtime skill activation.
 */
const COMPOSER_REFERENCE_REGEX = /(?:^|\s)(@\S+|\/[a-z0-9][a-z0-9-_]*)(?=$|\s|[.,!?;:)\]}>'"])/gi
const TRAILING_FILE_REFERENCE_PUNCTUATION = /[.,!?;:)\]}>'"]+$/u

/**
 * Splits text into an array of ReactNode items, replacing composer references
 * with inline file or skill chips. Plain text segments are returned as strings.
 */
export function renderTextWithMentions(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let key = 0

  for (const match of text.matchAll(COMPOSER_REFERENCE_REGEX)) {
    const fullMatch = match[0]
    const rawReference = match[1]
    if (!rawReference) continue
    const reference = rawReference.startsWith('@')
      ? rawReference.replace(TRAILING_FILE_REFERENCE_PUNCTUATION, '')
      : rawReference
    if (reference === '@') continue
    const matchStart = match.index + (fullMatch.length - rawReference.length)

    if (matchStart > lastIndex) {
      parts.push(text.slice(lastIndex, matchStart))
    }

    key += 1
    parts.push(
      reference.startsWith('@') ? (
        <FileReferenceChip key={key} reference={reference} />
      ) : (
        <SkillReferenceChip key={key} reference={reference} />
      ),
    )

    lastIndex = matchStart + reference.length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

function FileReferenceChip({ reference }: { readonly reference: string }) {
  const openWorkspaceFile = useOpenWorkspaceFile()
  const filePath = reference.slice(1)
  const slashIndex = filePath.lastIndexOf('/')
  const basename = slashIndex >= 0 ? filePath.slice(slashIndex + 1) : filePath

  return (
    <Button
      variant="unstyled"
      className={`${referenceChipClassName()} hover:bg-accent/20`}
      title={`Open ${filePath}`}
      onClick={() => openWorkspaceFile(filePath)}
    >
      <FileText size={ICON_SIZE} className="shrink-0" />
      <span>{basename}</span>
    </Button>
  )
}

function SkillReferenceChip({ reference }: { readonly reference: string }) {
  return (
    <span className={referenceChipClassName()} title={reference}>
      <Sparkles size={ICON_SIZE} className="shrink-0" />
      <span>{reference.slice(1)}</span>
    </span>
  )
}

function referenceChipClassName() {
  return cn(
    'bg-accent/10 text-accent rounded px-1.5 py-0.5 text-sm',
    'inline-flex items-center gap-1',
    'select-none cursor-default',
  )
}
