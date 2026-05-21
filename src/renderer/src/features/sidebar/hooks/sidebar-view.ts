import type { SidebarView } from '../model'

export function activeViewFromPathname(pathname: string): SidebarView {
  if (pathname.startsWith('/skills')) return 'skills'
  if (pathname.startsWith('/settings')) return 'settings'
  return 'chat'
}
