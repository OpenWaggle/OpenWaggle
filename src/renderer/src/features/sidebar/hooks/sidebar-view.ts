import type { SidebarView } from '../model/sidebar-types'

export function activeViewFromPathname(pathname: string) {
  if (
    pathname.startsWith('/settings') ||
    pathname.startsWith('/agents') ||
    pathname.startsWith('/skills') ||
    pathname.startsWith('/usage')
  ) {
    return 'settings' satisfies SidebarView
  }
  return 'chat' satisfies SidebarView
}
