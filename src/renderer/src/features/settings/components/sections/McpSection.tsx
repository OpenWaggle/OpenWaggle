import { Network } from 'lucide-react'
import { useResourceProject } from '@/features/settings/hooks/useResourceProject'
import { ProjectPicker } from '@/shared/ui/ProjectPicker'
import { McpRegistryPanel } from './mcp/McpRegistryPanel'
import { McpServersPanel } from './mcp/McpServersPanel'

/** Settings > MCP: a view over Pi's MCP files and servers, read and changed through the Host. */
export function McpSection() {
  const project = useResourceProject()
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Network className="size-5 text-accent" />
            <h2 className="text-xl font-semibold text-text-primary">MCP</h2>
          </div>
          <p className="max-w-190 text-xs leading-5 text-text-tertiary">
            MCP servers give the model more tools. Each server shows the file it comes from; changes
            are saved back to that file.
          </p>
        </div>
        <ProjectPicker
          resourceName="MCP servers"
          projects={project.projects}
          selectedProject={project.projectPath}
          displayNames={project.displayNames}
          onSelect={project.setSelectedProject}
          onOpenFolder={() => void project.openFolder()}
          loadProjectsPage={project.loadProjectsPage}
        />
      </div>
      {project.folderError ? (
        <p role="alert" className="text-xs text-error-text">
          {project.folderError}
        </p>
      ) : null}
      <McpServersPanel key={project.projectPath} projectPath={project.projectPath} />
      <McpRegistryPanel key={`registry:${project.projectPath}`} projectPath={project.projectPath} />
    </div>
  )
}
