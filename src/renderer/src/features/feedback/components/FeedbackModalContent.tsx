import type { AgentErrorInfo } from '@shared/types/errors'
import type { FeedbackCategory } from '@shared/types/feedback'
import {
  Bug,
  CheckCircle2,
  CircleAlert,
  Copy,
  ExternalLink,
  HelpCircle,
  Lightbulb,
  Loader2,
} from 'lucide-react'
import type { UseFeedbackReturn } from '@/features/feedback/hooks/useFeedback'
import { cn } from '@/shared/lib/cn'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Textarea } from '@/shared/ui/Textarea'
import { TextInput } from '@/shared/ui/TextInput'

const logger = createRendererLogger('feedback')
const DESCRIPTION_ROWS = 4
const FEEDBACK_TITLE_INPUT_ID = 'feedback-title'
const FEEDBACK_DESCRIPTION_INPUT_ID = 'feedback-description'

interface CategoryOption {
  value: FeedbackCategory
  label: string
  icon: React.JSX.Element
}

const CATEGORIES: CategoryOption[] = [
  { value: 'bug', label: 'Bug', icon: <Bug className="size-3.5" /> },
  { value: 'feature', label: 'Feature', icon: <Lightbulb className="size-3.5" /> },
  { value: 'question', label: 'Question', icon: <HelpCircle className="size-3.5" /> },
]

interface FeedbackModalBodyProps {
  readonly fb: UseFeedbackReturn
  readonly ghReady: boolean | undefined
  readonly errorContext: AgentErrorInfo | null
  readonly lastUserMessage: string | null
}

export function FeedbackModalBody({
  fb,
  ghReady,
  errorContext,
  lastUserMessage,
}: FeedbackModalBodyProps) {
  return (
    <div className="space-y-4 p-4">
      <div className="flex gap-2">
        {CATEGORIES.map((cat) => (
          <Button
            variant={fb.category === cat.value ? 'accent' : 'secondary'}
            key={cat.value}
            onClick={() => fb.setCategory(cat.value)}
          >
            {cat.icon}
            {cat.label}
          </Button>
        ))}
      </div>

      <label className="block" htmlFor={FEEDBACK_TITLE_INPUT_ID}>
        <span className="mb-1.5 block text-[13px] font-medium text-text-secondary">Title</span>
        <TextInput
          id={FEEDBACK_TITLE_INPUT_ID}
          type="text"
          value={fb.title}
          onChange={(e) => fb.setTitle(e.target.value)}
          placeholder="Brief summary of the issue"
        />
      </label>

      <label className="block" htmlFor={FEEDBACK_DESCRIPTION_INPUT_ID}>
        <span className="mb-1.5 block text-[13px] font-medium text-text-secondary">
          Description
        </span>
        <Textarea
          id={FEEDBACK_DESCRIPTION_INPUT_ID}
          rows={DESCRIPTION_ROWS}
          value={fb.description}
          onChange={(e) => fb.setDescription(e.target.value)}
          placeholder="Steps to reproduce, expected vs. actual behavior..."
          resize="none"
          className="rounded-md border-border text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/50"
        />
      </label>

      <FeedbackAttachmentOptions
        fb={fb}
        errorContext={errorContext}
        lastUserMessage={lastUserMessage}
      />
      {fb.ghStatus !== null && <GhCliStatusBanner fb={fb} ghReady={ghReady} />}
      {fb.error && <p className="text-[13px] text-error">{fb.error}</p>}
    </div>
  )
}

function FeedbackAttachmentOptions({
  fb,
  errorContext,
  lastUserMessage,
}: {
  readonly fb: UseFeedbackReturn
  readonly errorContext: AgentErrorInfo | null
  readonly lastUserMessage: string | null
}) {
  return (
    <div className="rounded-md border border-border bg-bg p-3">
      <p className="mb-2 text-[12px] font-medium text-text-tertiary">Include with report</p>
      <div className="space-y-1.5">
        <ToggleRow
          label="System info (OS, versions)"
          checked={fb.includeSystemInfo}
          onChange={fb.setIncludeSystemInfo}
        />
        <ToggleRow
          label="Recent logs (last 100 lines)"
          checked={fb.includeLogs}
          onChange={fb.setIncludeLogs}
        />
        <ToggleRow
          label="Last error context"
          checked={fb.includeErrorContext}
          onChange={fb.setIncludeErrorContext}
          disabled={!errorContext}
        />
        <ToggleRow
          label="Last user message"
          checked={fb.includeLastMessage}
          onChange={fb.setIncludeLastMessage}
          disabled={!lastUserMessage}
        />
        <ToggleRow
          label="Model & provider info"
          checked={fb.includeModelInfo}
          onChange={fb.setIncludeModelInfo}
        />
      </div>
    </div>
  )
}

function GhCliStatusBanner({
  fb,
  ghReady,
}: {
  readonly fb: UseFeedbackReturn
  readonly ghReady: boolean | undefined
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-[13px]',
        ghReady
          ? 'border-success/30 bg-success/6 text-success'
          : 'border-warning/30 bg-warning/6 text-warning',
      )}
    >
      {ghReady ? (
        <>
          <CheckCircle2 className="size-3.5 shrink-0" />
          Ready to submit via GitHub CLI
        </>
      ) : (
        <>
          <CircleAlert className="size-3.5 shrink-0" />
          <GhCliHelpText available={!!fb.ghStatus?.available} />
        </>
      )}
    </div>
  )
}

function GhCliHelpText({ available }: { readonly available: boolean }) {
  return (
    <span>
      {available ? 'GitHub CLI not authenticated — run ' : 'GitHub CLI not found — install from '}
      {available ? (
        <code className="rounded bg-bg px-1 py-0.5 text-[12px]">gh auth login</code>
      ) : (
        <Button
          variant="link"
          size="none"
          onClick={() => {
            api.openExternal('https://cli.github.com').catch((err: unknown) => {
              logger.warn('Failed to open external URL', { error: String(err) })
            })
          }}
        >
          cli.github.com
        </Button>
      )}
      {' — or use "Copy & Open GitHub" below'}
    </span>
  )
}

interface FeedbackModalFooterProps {
  readonly fb: UseFeedbackReturn
  readonly canSubmit: boolean
  readonly ghReady: boolean | undefined
  readonly onClose: () => void
}

export function FeedbackModalFooter({ fb, canSubmit, ghReady, onClose }: FeedbackModalFooterProps) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="secondary" onClick={() => void fb.copyAndOpen()}>
        <Copy className="size-3" />
        Copy & Open GitHub
        <ExternalLink className="size-3" />
      </Button>
      <Button
        variant={canSubmit && ghReady ? 'primary' : 'secondary'}
        onClick={() => void fb.submit()}
        disabled={!canSubmit || !ghReady}
      >
        {fb.submitting && <Loader2 className="size-3.5 animate-spin" />}
        Submit Issue
      </Button>
    </div>
  )
}

interface ToggleRowProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

function ToggleRow({ label, checked, onChange, disabled }: ToggleRowProps) {
  return (
    <Checkbox
      checked={checked && !disabled}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      label={label}
      labelClassName={cn(disabled ? 'text-text-tertiary/50' : 'text-text-secondary')}
    />
  )
}
