import type { SidebarView } from '../model'

export function activeViewFromPathname(pathname: string): SidebarView {
  if (
    pathname.startsWith('/settings') ||
    pathname.startsWith('/agents') ||
    pathname.startsWith('/skills')
  )
    return 'settings'
  return 'chat'
}
