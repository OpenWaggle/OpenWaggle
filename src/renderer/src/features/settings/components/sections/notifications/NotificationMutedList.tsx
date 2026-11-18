import type { DesktopNotificationSettings } from '@shared/types/desktop-notification'
import { projectNameFromPath } from '@shared/utils/desktop-notification-copy'
import { usePreferencesStore } from '@/features/settings/state'
import { Button } from '@/shared/ui/Button'
import { Row } from './NotificationSettingRow'

/** The Sessions and projects with a Notification mute, each with Unmute. */
export function MutedList({
  settings,
  onChange,
}: {
  readonly settings: DesktopNotificationSettings
  readonly onChange: (next: DesktopNotificationSettings) => void
}) {
  const sessionTitles = usePreferencesStore((state) => state.settings.projectDisplayNames)
  const projects = settings.mutedProjectPaths
  const sessions = settings.mutedSessionIds
  if (projects.length === 0 && sessions.length === 0) {
    return (
      <p className="text-xs text-text-tertiary">
        Nothing is muted. Mute a Session or project from its menu in the sidebar; Needs you always
        notifies.
      </p>
    )
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg">
      {projects.map((projectPath) => (
        <Row
          key={`project:${projectPath}`}
          label={sessionTitles[projectPath] ?? projectNameFromPath(projectPath)}
          description={projectPath}
        >
          <Button
            size="sm"
            onClick={() =>
              onChange({
                ...settings,
                mutedProjectPaths: projects.filter((path) => path !== projectPath),
              })
            }
          >
            Unmute
          </Button>
        </Row>
      ))}
      {sessions.map((sessionId) => (
        <Row key={`session:${sessionId}`} label="Session" description={sessionId}>
          <Button
            size="sm"
            onClick={() =>
              onChange({ ...settings, mutedSessionIds: sessions.filter((id) => id !== sessionId) })
            }
          >
            Unmute
          </Button>
        </Row>
      ))}
    </div>
  )
}
