import { match } from '@diegogbrisa/ts-match'
import type { DesktopNotificationPermissionStatus } from '@shared/types/desktop-notification'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'
import { Row } from './NotificationSettingRow'

const logger = createRendererLogger('settings/notifications')

function permissionText(status: DesktopNotificationPermissionStatus) {
  return match(status)
    .with('allowed', () => 'Allowed')
    .with('blocked', () => 'Blocked by the system. Sounds, the badge and the sidebar still work.')
    .with('not-asked', () => 'Not asked yet. OpenWaggle asks when you start your first Run.')
    .with('unsupported', () => 'This system cannot show notifications.')
    .exhaustive()
}

export function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function usePermissionStatus() {
  const [status, setStatus] = useState<DesktopNotificationPermissionStatus | null>(null)
  useEffect(() => {
    let cancelled = false
    void api
      .getDesktopNotificationPermissionStatus()
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch((error: unknown) =>
        logger.warn('Could not read notification permission', { error: describe(error) }),
      )
    const release = api.onDesktopNotificationPermissionChanged(setStatus)
    return () => {
      cancelled = true
      release()
    }
  }, [])
  return [status, setStatus] as const
}

/** What the operating system lets OpenWaggle show, with a test and a way to change it. */
export function PermissionCard() {
  const [status, setStatus] = usePermissionStatus()
  const [sending, setSending] = useState(false)
  const sendTest = () => {
    setSending(true)
    void api
      .sendTestDesktopNotification()
      .then(setStatus)
      .catch((error: unknown) =>
        logger.warn('Could not send a test notification', { error: describe(error) }),
      )
      .finally(() => setSending(false))
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg">
      <Row label="System permission" description={status ? permissionText(status) : 'Checking…'}>
        <Button
          size="sm"
          onClick={() =>
            void api
              .openDesktopNotificationSystemSettings()
              .catch((error: unknown) =>
                logger.warn('Could not open system settings', { error: describe(error) }),
              )
          }
        >
          Open System Settings
        </Button>
        <Button size="sm" onClick={sendTest} disabled={sending || status === 'unsupported'}>
          Send test notification
        </Button>
      </Row>
    </div>
  )
}
