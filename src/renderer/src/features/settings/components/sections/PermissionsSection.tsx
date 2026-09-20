import { useResourceProject } from '@/features/settings'
import { ProjectPicker } from '@/shared/ui/ProjectPicker'
import { AgentAccessSection } from './AgentAccessSection'

export function PermissionsSection() {
  const project = useResourceProject()

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Permissions</h2>
          <p className="text-xs text-text-tertiary">Access modes and saved approvals.</p>
        </div>
        <ProjectPicker
          resourceName="permissions"
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
      <AgentAccessSection key={project.projectPath} projectPath={project.projectPath} />
    </div>
  )
}
