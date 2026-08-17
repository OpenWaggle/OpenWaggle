import type { McpCapabilityCatalog, McpGetSettingsInput } from '@shared/types/mcp'
import { AppWindow, BookOpen, FileText, MessageSquareText, ScrollText, Timer } from 'lucide-react'
import { CapabilityGroup, PromptCard, ResourceCard, TaskCard } from './McpCapabilityCards'
import { RemoteSkillCard, ServerInstructionsCard } from './McpSkillCards'

export function McpCapabilityCatalogGroups({
  catalog,
  context,
  onTasksChanged,
}: {
  readonly catalog: McpCapabilityCatalog
  readonly context: McpGetSettingsInput
  readonly onTasksChanged: () => void
}) {
  return (
    <>
      {catalog.instructions.length > 0 && (
        <CapabilityGroup title="Server instructions" icon={<ScrollText className="size-4" />}>
          {catalog.instructions.map((instructions) => (
            <ServerInstructionsCard
              key={instructions.serverInstanceId}
              descriptor={instructions}
              canDraft={Boolean(context.sessionId)}
            />
          ))}
        </CapabilityGroup>
      )}
      {catalog.prompts.length > 0 && (
        <CapabilityGroup title="Prompts" icon={<MessageSquareText className="size-4" />}>
          {catalog.prompts.map((prompt) => (
            <PromptCard
              key={`${prompt.serverInstanceId}:${prompt.name}`}
              prompt={prompt}
              context={context}
              disabled={!context.sessionId}
            />
          ))}
        </CapabilityGroup>
      )}
      {catalog.resources.length > 0 && (
        <CapabilityGroup title="Resources" icon={<FileText className="size-4" />}>
          {catalog.resources.map((resource) => (
            <ResourceCard
              key={`${resource.serverInstanceId}:${resource.uri}`}
              resource={resource}
              context={context}
              canAttach={Boolean(context.sessionId)}
            />
          ))}
        </CapabilityGroup>
      )}
      {catalog.skills.length > 0 && (
        <CapabilityGroup
          title="Remote Skills (experimental)"
          icon={<BookOpen className="size-4" />}
        >
          {catalog.skills.map((skill) => (
            <RemoteSkillCard
              key={`${skill.serverInstanceId}:${skill.uri}`}
              skill={skill}
              context={context}
              canDraft={Boolean(context.sessionId)}
            />
          ))}
        </CapabilityGroup>
      )}
      {catalog.apps.length > 0 && (
        <CapabilityGroup title="MCP Apps" icon={<AppWindow className="size-4" />}>
          {catalog.apps.map((app) => (
            <div
              key={`${app.serverInstanceId}:${app.toolName}`}
              className="rounded-md border border-border bg-bg px-3 py-3"
            >
              <p className="text-[13px] font-medium text-text-primary">{app.toolTitle}</p>
              <p className="text-[11px] text-text-muted">
                {app.serverLabel} · sandboxed ui:// resource
              </p>
            </div>
          ))}
        </CapabilityGroup>
      )}
      {catalog.tasks.length > 0 && (
        <CapabilityGroup title="Remote Tasks" icon={<Timer className="size-4" />}>
          {catalog.tasks.map((task) => (
            <TaskCard key={task.id} record={task} context={context} onChanged={onTasksChanged} />
          ))}
        </CapabilityGroup>
      )}
    </>
  )
}
