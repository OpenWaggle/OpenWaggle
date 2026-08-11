import type {
  McpGetSettingsInput,
  McpPromptDescriptor,
  McpResourceDescriptor,
  McpResourceResult,
  McpTaskRecord,
} from '@shared/types/mcp'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { setComposerTextValue } from '@/features/chat/lib'
import { useComposerStore } from '@/features/composer/state'
import {
  promptDraftText,
  resourceAttachmentText,
} from '@/features/settings/lib/mcp-capability-formatters'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import { useUIStore } from '@/shell/ui-store'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function PromptCard({
  prompt,
  context,
  disabled,
}: {
  readonly prompt: McpPromptDescriptor
  readonly context: McpGetSettingsInput
  readonly disabled: boolean
}) {
  const [arguments_, setArguments] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const showToast = useUIStore((state) => state.showToast)

  async function createDraft() {
    setBusy(true)
    try {
      const result = await api.getMcpPrompt({
        ...context,
        serverInstanceId: prompt.serverInstanceId,
        name: prompt.name,
        arguments: arguments_,
      })
      setComposerTextValue(promptDraftText(result))
      showToast(`Editable draft created from ${prompt.serverLabel}.`, 'success')
    } catch (error) {
      showToast(`MCP prompt needs attention: ${errorMessage(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-bg px-3 py-3">
      <div>
        <p className="text-[13px] font-medium text-text-primary">{prompt.title ?? prompt.name}</p>
        <p className="text-[11px] text-text-muted">{prompt.serverLabel}</p>
        {prompt.description && (
          <p className="mt-1 text-[12px] text-text-tertiary">{prompt.description}</p>
        )}
      </div>
      {prompt.arguments.map((argument) => {
        const fieldId = `mcp-prompt-${prompt.serverInstanceId}-${prompt.name}-${argument.name}`
        return (
          <label
            key={argument.name}
            htmlFor={fieldId}
            className="block space-y-1 text-[11px] text-text-secondary"
          >
            <span>
              {argument.name}
              {argument.required ? ' · required' : ''}
            </span>
            <TextInput
              id={fieldId}
              inputSize="sm"
              value={arguments_[argument.name] ?? ''}
              placeholder={argument.description}
              onChange={(event) =>
                setArguments((current) => ({ ...current, [argument.name]: event.target.value }))
              }
            />
          </label>
        )
      })}
      <Button
        type="button"
        disabled={
          disabled ||
          busy ||
          prompt.arguments.some(
            (argument) => argument.required && !arguments_[argument.name]?.trim(),
          )
        }
        onClick={() => void createDraft()}
      >
        Create editable draft
      </Button>
    </div>
  )
}

export function ResourceCard({
  resource,
  context,
  canAttach,
}: {
  readonly resource: McpResourceDescriptor
  readonly context: McpGetSettingsInput
  readonly canAttach: boolean
}) {
  const [result, setResult] = useState<McpResourceResult | null>(null)
  const [busy, setBusy] = useState(false)
  const showToast = useUIStore((state) => state.showToast)

  async function read() {
    setBusy(true)
    try {
      setResult(
        await api.readMcpResource({
          ...context,
          serverInstanceId: resource.serverInstanceId,
          uri: resource.uri,
        }),
      )
    } catch (error) {
      showToast(`MCP resource needs attention: ${errorMessage(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function attach() {
    if (!result) return
    setBusy(true)
    try {
      const attachment = await api.prepareAttachmentFromText(
        resourceAttachmentText(result, resource.uri),
        crypto.randomUUID(),
      )
      useComposerStore
        .getState()
        .addAttachments([{ ...attachment, name: `MCP · ${resource.title ?? resource.name}` }])
      showToast(`Attached ${resource.name} with MCP provenance.`, 'success')
    } catch (error) {
      showToast(`MCP resource could not be attached: ${errorMessage(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-bg px-3 py-3">
      <div>
        <p className="text-[13px] font-medium text-text-primary">
          {resource.title ?? resource.name}
        </p>
        <p className="break-all text-[11px] text-text-muted">
          {resource.serverLabel} · {resource.uri}
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="button" disabled={busy} onClick={() => void read()}>
          Inspect
        </Button>
        {result && (
          <Button type="button" disabled={busy || !canAttach} onClick={() => void attach()}>
            Attach to composer
          </Button>
        )}
      </div>
      {result && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-bg-secondary p-2 text-[11px] text-text-secondary">
          {resourceAttachmentText(result, resource.uri)}
        </pre>
      )}
    </div>
  )
}

export function TaskCard({
  record,
  context,
  onChanged,
}: {
  readonly record: McpTaskRecord
  readonly context: McpGetSettingsInput
  readonly onChanged: () => void
}) {
  const taskId = record.remoteTaskId
  const status = record.status
  const showToast = useUIStore((state) => state.showToast)

  async function cancel() {
    if (!taskId) return
    const confirmed = await api.showConfirm(
      'Cancel this remote MCP task?',
      `${record.serverLabel} reports task ${taskId} as ${status}. Cancellation depends on server support.`,
    )
    if (!confirmed) return
    try {
      await api.operateMcpTask({
        ...context,
        serverInstanceId: record.serverInstanceId,
        operation: 'cancel',
        taskId,
      })
      onChanged()
    } catch (error) {
      showToast(`Remote task may still be running: ${errorMessage(error)}`, 'error')
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg px-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-text-primary">
          {taskId ?? 'Remote task'}
        </p>
        <p className="text-[11px] text-text-muted">
          {record.serverLabel} · {status}
          {record.disabled ? ' · server disabled; remote work may continue' : ''}
        </p>
      </div>
      <Button
        type="button"
        disabled={record.disabled || ['cancelled', 'completed', 'failed'].includes(status)}
        onClick={() => void cancel()}
      >
        {record.disabled ? 'Re-enable to cancel' : 'Cancel'}
      </Button>
    </div>
  )
}

export function CapabilityGroup({
  title,
  icon,
  children,
}: {
  readonly title: string
  readonly icon: ReactNode
  readonly children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[12px] font-medium text-text-secondary">
        {icon}
        {title}
      </div>
      <div className="grid gap-2 md:grid-cols-2">{children}</div>
    </div>
  )
}
