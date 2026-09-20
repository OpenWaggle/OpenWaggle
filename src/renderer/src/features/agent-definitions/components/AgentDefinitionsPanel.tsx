import type { AgentDefinitionDisplayItem } from '@shared/types/agent-definition'
import { RefreshCw } from 'lucide-react'
import { useProject } from '@/features/sessions/hooks'
import { cn } from '@/shared/lib/cn'
import { formatDisplayPath } from '@/shared/lib/display-path'
import { Button } from '@/shared/ui/Button'
import { MarkdownDocument } from '@/shared/ui/MarkdownDocument'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'
import { Spinner } from '@/shared/ui/Spinner'
import { SyntaxBlock } from '@/shared/ui/SyntaxBlock'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import { useAgentDefinitions } from '../hooks/useAgentDefinitions'

function AgentFilePreview({ markdown }: { readonly markdown: string }) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdown.trimStart())
  if (!match) {
    return (
      <PlainTextBlock reason="unknown-language" ariaLabel="Agent Markdown source">
        {markdown}
      </PlainTextBlock>
    )
  }
  const [, frontmatter, body] = match
  return (
    <>
      <SyntaxBlock
        source={`---\n${frontmatter}\n---`}
        language="yaml"
        ariaLabel="Agent frontmatter"
        className="mb-5"
      />
      <MarkdownDocument className="max-w-none">{body ?? ''}</MarkdownDocument>
    </>
  )
}

function AgentRow({
  item,
  selected,
  onSelect,
  onToggle,
}: {
  readonly item: AgentDefinitionDisplayItem
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onToggle: (enabled: boolean) => void
}) {
  return (
    <div
      className={cn(
        'flex w-full items-start gap-2 rounded-md border px-2.5 py-2 transition-colors',
        selected
          ? 'border-accent/40 bg-bg-hover'
          : 'border-transparent hover:border-border hover:bg-bg-hover/70',
      )}
    >
      <Button
        variant="unstyled"
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate text-xs font-medium text-text-primary">{item.name}</span>
        <span className="mt-1 block text-xs text-text-tertiary">{item.description}</span>
        <span className="mt-1.5 block text-xs text-text-muted">
          {item.scope === 'portable-project'
            ? '.agents/agents'
            : item.scope === 'project'
              ? '.openwaggle/agents'
              : 'User agents'}
          {item.loadError ? <span className="ml-2 text-error">invalid</span> : null}
        </span>
      </Button>
      <ToggleSwitch
        checked={item.enabled}
        label={`${item.enabled ? 'Disable' : 'Enable'} ${item.name}`}
        size="compact"
        onCheckedChange={onToggle}
      />
    </div>
  )
}

function AgentPreview({
  item,
  projectPath,
  markdown,
  isLoading,
}: {
  readonly item: AgentDefinitionDisplayItem | null
  readonly projectPath: string
  readonly markdown: string
  readonly isLoading: boolean
}) {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4">
      {!item ? (
        <div className="rounded-lg border border-border bg-bg-secondary p-4 text-sm text-text-tertiary">
          Select an agent to preview its Markdown file.
        </div>
      ) : (
        <>
          <div className="mb-4 border-b border-border pb-3">
            <h3 className="text-sm font-semibold text-text-primary">{item.name}</h3>
            <p className="mt-1 break-all text-xs text-text-tertiary">
              {formatDisplayPath(item.sourcePath, [projectPath])}
            </p>
            {!item.enabled && (
              <p className="mt-2 text-xs text-text-muted">Disabled for new sessions</p>
            )}
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-text-tertiary">
              <Spinner />
              Loading preview…
            </div>
          ) : (
            <AgentFilePreview markdown={markdown} />
          )}
        </>
      )}
    </div>
  )
}

export function AgentDefinitionsPanel() {
  const { projectPath } = useProject()
  const agents = useAgentDefinitions(projectPath)
  if (!projectPath) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-bg text-sm text-text-tertiary">
        Select a project folder to browse its agents.
      </div>
    )
  }
  const selected = agents.items.find((item) => item.name === agents.selectedName) ?? null
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Agents</h2>
          <p className="text-xs text-text-tertiary">Markdown definitions for Worker Sessions.</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<RefreshCw className="size-3.5" />}
          onClick={() => void agents.refresh()}
        >
          Refresh
        </Button>
      </div>
      {agents.error && (
        <p
          role="alert"
          className="border-b border-error/30 bg-error/10 px-5 py-2 text-xs text-error"
        >
          {agents.error instanceof Error ? agents.error.message : 'Could not load agents.'}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-75 shrink-0 min-h-0 flex-col border-r border-border">
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {agents.isLoading ? (
              <div className="flex justify-center py-6 text-text-tertiary">
                <Spinner />
              </div>
            ) : agents.items.length === 0 ? (
              <div className="rounded-lg border border-border bg-bg-secondary p-3 text-xs text-text-tertiary">
                No agents found. Add a Markdown file to <code>.agents/agents/</code> to define one;
                workers need no definition by default.
              </div>
            ) : (
              agents.items.map((item) => (
                <AgentRow
                  key={item.name}
                  item={item}
                  selected={agents.selectedName === item.name}
                  onSelect={() => agents.selectAgent(item.name)}
                  onToggle={(enabled) => agents.toggleAgent(item.name, enabled)}
                />
              ))
            )}
          </div>
        </div>
        <AgentPreview
          item={selected}
          projectPath={projectPath}
          markdown={agents.previewMarkdown}
          isLoading={agents.isPreviewLoading}
        />
      </div>
    </div>
  )
}
