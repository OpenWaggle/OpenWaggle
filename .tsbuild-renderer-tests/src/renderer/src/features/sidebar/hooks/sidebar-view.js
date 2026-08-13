export function activeViewFromPathname(pathname) {
    if (pathname.startsWith('/skills'))
        return 'skills';
    if (pathname.startsWith('/settings'))
        return 'settings';
    return 'chat';
}
