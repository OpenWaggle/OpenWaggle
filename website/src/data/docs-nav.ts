export interface NavItem {
  title: string;
  slug: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

// Navigation labels describe tasks. Slugs stay stable so existing links keep working.
export const docsNav: NavSection[] = [
  {
    title: 'Getting started',
    items: [
      { title: 'Get started', slug: 'getting-started/first-run' },
      { title: 'Installation', slug: 'getting-started/installation' },
    ],
  },
  {
    title: 'Using OpenWaggle',
    items: [
      { title: 'Conversations and context', slug: 'using-openwaggle/chat-and-tools' },
      { title: 'Files, images, and voice', slug: 'using-openwaggle/attachments-voice' },
      { title: 'Reviewing changes and Git', slug: 'developer-workflow/git-integration' },
      { title: 'Browser preview', slug: 'developer-workflow/browser-preview' },
      { title: 'Terminal', slug: 'developer-workflow/built-in-terminal' },
      { title: 'Sessions and branches', slug: 'using-openwaggle/session-tree' },
      { title: 'Session summary', slug: 'using-openwaggle/session-summary' },
      { title: 'Projects and worktrees', slug: 'developer-workflow/projects-and-worktrees' },
    ],
  },
  {
    title: 'Customize',
    items: [
      { title: 'Providers and models', slug: 'providers/overview' },
      { title: 'Approvals and permissions', slug: 'configuration/approvals-permissions' },
      { title: 'Project instructions', slug: 'extending/agents-md' },
      { title: 'Skills', slug: 'extending/skills-system' },
      { title: 'MCP connections', slug: 'configuration/mcp' },
      { title: 'Extensions', slug: 'extending/plugins' },
      { title: 'Project actions', slug: 'configuration/project-actions' },
      { title: 'Settings', slug: 'configuration/app-settings' },
      { title: 'Keyboard shortcuts', slug: 'getting-started/keyboard-shortcuts' },
    ],
  },
  {
    title: 'Multiple agents',
    items: [
      { title: 'Hives', slug: 'using-openwaggle/hives-and-sessions' },
      { title: 'Waggle', slug: 'using-openwaggle/waggle-mode' },
      { title: 'Agent definitions', slug: 'extending/agent-definitions' },
    ],
  },
  {
    title: 'Help',
    items: [
      { title: 'Troubleshooting and recovery', slug: 'configuration/session-recovery' },
      { title: 'Privacy and data', slug: 'configuration/security-privacy' },
    ],
  },
];

export const developerDocsNav: NavSection[] = [
  {
    title: 'Developer docs',
    items: [
      { title: 'Build from source', slug: 'developer-guide/building-from-source' },
      { title: 'Contributing', slug: 'developer-guide/contributing' },
      { title: 'Architecture', slug: 'developer-guide/architecture' },
      { title: 'Pi runtime', slug: 'developer-workflow/pi-runtime' },
      { title: 'Sessions CLI', slug: 'developer-workflow/sessions-cli' },
      { title: 'Token benchmarks', slug: 'using-openwaggle/token-benchmarks' },
      { title: 'Build an extension', slug: 'extending/openwaggle-extensions' },
      { title: 'Pi extensions', slug: 'extending/pi-extensions' },
    ],
  },
  {
    title: 'Package reference',
    items: [
      { title: 'Overview', slug: 'packages/overview' },
      { title: 'Extension SDK', slug: 'packages/extension-sdk' },
      { title: 'Extension React', slug: 'packages/extension-react' },
      { title: 'Waggle Core', slug: 'packages/waggle-core' },
      { title: 'Pi Waggle', slug: 'packages/pi-waggle' },
    ],
  },
];

export function isDeveloperDoc(slug: string): boolean {
  return developerDocsNav.some((section) =>
    section.items.some((item) => slug === item.slug || slug.startsWith(`${item.slug}/`)),
  );
}

export function flatNavItems(): NavItem[] {
  return [...docsNav, ...developerDocsNav].flatMap((section) => section.items);
}

export function getPrevNext(currentSlug: string) {
  const sections = isDeveloperDoc(currentSlug) ? developerDocsNav : docsNav;
  const flat = sections.flatMap((section) => section.items);
  const index = flat.findIndex((item) => item.slug === currentSlug);
  return {
    prev: index > 0 ? flat[index - 1] : null,
    next: index >= 0 && index < flat.length - 1 ? flat[index + 1] : null,
  };
}
