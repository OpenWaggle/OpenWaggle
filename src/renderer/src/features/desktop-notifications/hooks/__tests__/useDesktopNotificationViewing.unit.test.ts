import { describe, expect, it } from 'vitest'
import { sessionIdOfPath } from '../useDesktopNotificationViewing'

describe('sessionIdOfPath', () => {
  it('reads the Session a route shows, and nothing for other pages', () => {
    expect(sessionIdOfPath('/sessions/abc-123')).toBe('abc-123')
    expect(sessionIdOfPath('/sessions/a%20b/tree')).toBe('a b')
    expect(sessionIdOfPath('/settings/notifications')).toBeNull()
    expect(sessionIdOfPath('/')).toBeNull()
    expect(sessionIdOfPath('/sessions/%E0%A4%A')).toBeNull()
  })
})
