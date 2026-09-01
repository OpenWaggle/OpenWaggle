import type {
  McpGetSettingsInput,
  McpRemoteSkillDescriptor,
  McpRemoteSkillReview,
  McpServerInstructionsDescriptor,
} from '@shared/types/mcp'
import { useState } from 'react'
import { setComposerTextValue } from '@/features/chat/lib'
import {
  remoteSkillDraftText,
  serverInstructionsDraftText,
} from '@/features/settings/lib/mcp-capability-formatters'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { MarkdownDocument } from '@/shared/ui/MarkdownDocument'
import { useUIStore } from '@/shell/ui-store'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function ServerInstructionsCard({
  descriptor,
  canDraft,
}: {
  readonly descriptor: McpServerInstructionsDescriptor
  readonly canDraft: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const showToast = useUIStore((state) => state.showToast)

  async function createDraft() {
    const confirmed = await api.showConfirm(
      'Add these untrusted MCP server instructions to an editable draft?',
      `${descriptor.serverLabel} authored this content. It cannot override OpenWaggle policy, trust, approvals, or secret handling.`,
    )
    if (!confirmed) return
    setComposerTextValue(serverInstructionsDraftText(descriptor))
    showToast(`Editable draft created from ${descriptor.serverLabel} instructions.`, 'success')
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-bg px-3 py-3">
      <div>
        <p className="text-xs font-medium text-text-primary">Server instructions</p>
        <p className="text-xs text-text-muted">
          {descriptor.serverLabel} · untrusted · never injected automatically
          {descriptor.truncated ? ' · truncated' : ''}
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="button" onClick={() => setExpanded((current) => !current)}>
          {expanded ? 'Hide' : 'Review'}
        </Button>
        <Button type="button" disabled={!canDraft} onClick={() => void createDraft()}>
          Add to editable draft
        </Button>
      </div>
      {expanded && (
        <MarkdownDocument className="max-h-64 overflow-auto rounded bg-bg-secondary p-2 text-xs">
          {descriptor.instructions}
        </MarkdownDocument>
      )}
    </div>
  )
}

export function RemoteSkillCard({
  skill,
  context,
  canDraft,
}: {
  readonly skill: McpRemoteSkillDescriptor
  readonly context: McpGetSettingsInput
  readonly canDraft: boolean
}) {
  const [review, setReview] = useState<McpRemoteSkillReview | null>(null)
  const [busy, setBusy] = useState(false)
  const showToast = useUIStore((state) => state.showToast)

  async function inspect() {
    setBusy(true)
    try {
      setReview(
        await api.reviewMcpRemoteSkill({
          ...context,
          serverInstanceId: skill.serverInstanceId,
          uri: skill.uri,
        }),
      )
    } catch (error) {
      setReview(null)
      showToast(`Remote Skill was not loaded: ${errorMessage(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function createDraft() {
    if (!review) return
    const confirmed = await api.showConfirm(
      'Add this untrusted remote Skill to an editable draft?',
      `${skill.name} comes from ${skill.serverLabel}. Scripts and allowed-tools are not executed or granted. Nested Skills require separate review.`,
    )
    if (!confirmed) return
    setComposerTextValue(remoteSkillDraftText(review))
    showToast(`Editable draft created from remote Skill ${skill.name}.`, 'success')
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-bg px-3 py-3">
      <div>
        <p className="text-xs font-medium text-text-primary">{skill.name}</p>
        <p className="break-all text-xs text-text-muted">
          {skill.serverLabel} · experimental SEP-2640 · {skill.integrity}
        </p>
        <p className="mt-1 text-xs text-text-tertiary">{skill.description}</p>
        <p className="mt-1 break-all text-xs text-text-muted">{skill.uri}</p>
      </div>
      <div className="flex gap-2">
        <Button type="button" disabled={busy} onClick={() => void inspect()}>
          {review ? 'Re-verify' : 'Review and verify'}
        </Button>
        {review && (
          <Button type="button" disabled={busy || !canDraft} onClick={() => void createDraft()}>
            Add to editable draft
          </Button>
        )}
      </div>
      {review && (
        <div className="space-y-2">
          <p className="text-xs text-text-muted">
            {review.digestVerified
              ? 'SKILL.md digest and frontmatter verified.'
              : 'Dynamic content: no digest manifest; approval cannot persist.'}
          </p>
          <MarkdownDocument className="max-h-64 overflow-auto rounded bg-bg-secondary p-2 text-xs">
            {review.markdown}
          </MarkdownDocument>
        </div>
      )}
    </div>
  )
}
