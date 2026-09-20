import { useState } from 'react'
import { useProject } from '@/features/sessions/hooks'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'

const PROJECT_PAGE_SIZE = 100

/** A Settings browser can inspect another project without changing the active Session. */
export function useResourceProject() {
  const { projectPath: activeProject, selectFolder } = useProject()
  const recentProjects = usePreferencesStore((state) => state.settings.recentProjects)
  const displayNames = usePreferencesStore((state) => state.settings.projectDisplayNames)
  const pushRecentProject = usePreferencesStore((state) => state.pushRecentProject)
  const sessions = useSessionStore((state) => state.sessions)
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [folderError, setFolderError] = useState<string | null>(null)
  const projects = [
    ...new Set(
      [activeProject, ...recentProjects, ...sessions.map((session) => session.projectPath)].filter(
        (path): path is string => typeof path === 'string' && path.trim().length > 0,
      ),
    ),
  ]
  const projectPath = selectedProject ?? projects[0] ?? null

  async function openFolder() {
    try {
      const path = await selectFolder()
      if (!path) return
      await pushRecentProject(path)
      setSelectedProject(path)
      setFolderError(null)
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : 'Could not open project folder.')
    }
  }

  return {
    projects,
    projectPath,
    displayNames,
    setSelectedProject,
    openFolder,
    folderError,
    loadProjectsPage: (cursor?: string, search?: string) =>
      api.listSessionProjectPage(PROJECT_PAGE_SIZE, cursor, search),
  }
}
