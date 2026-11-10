export interface NavItem {
  title: string
  slug: string
}

export interface NavSection {
  title: string
  items: NavItem[]
}

// Navigation labels describe tasks. Slugs stay stable so existing links keep working.
export const docsNav: NavSection[] = [
  {
    title: 'Getting started',
    items: [
      { title: 'Get started', slug: 'getting-started/first-run' },
      { title: 'Installation', slug: 'getting-started/installation' },
      { title: 'How OpenWaggle works', slug: 'getting-started/how-openwaggle-works' },
    ],
  },
  {
    title: 'Using OpenWaggle',
    items: [
      { title: 'Conversations and tools', slug: 'using-openwaggle/chat-and-tools' },
      { title: 'Sessions from the Pi CLI', slug: 'using-openwaggle/pi-cli-sessions' },
      { title: 'Files, images, and voice', slug: 'using-openwaggle/attachments-voice' },
      { title: 'Codemode', slug: 'using-openwaggle/codemode' },
      { title: 'Visualizations', slug: 'using-openwaggle/visualizations' },
      { title: 'Context and compaction', slug: 'using-openwaggle/context-management' },
      { title: 'Usage and cost', slug: 'using-openwaggle/usage-and-cost' },
      { title: 'Right panel', slug: 'using-openwaggle/right-panel' },
      { title: 'Session Summary', slug: 'using-openwaggle/session-summary' },
      { title: 'Sessions and branches', slug: 'using-openwaggle/session-tree' },
      { title: 'Reviewing changes and Git', slug: 'developer-workflow/git-integration' },
      { title: 'Pull and merge requests', slug: 'developer-workflow/pull-requests' },
      { title: 'Browser preview', slug: 'developer-workflow/browser-preview' },
      { title: 'Terminal', slug: 'developer-workflow/built-in-terminal' },
      { title: 'Projects and worktrees', slug: 'developer-workflow/projects-and-worktrees' },
      { title: 'Scheduled tasks', slug: 'using-openwaggle/scheduled-tasks' },
    ],
  },
  {
    title: 'Customize',
    items: [
      { title: 'Providers and models', slug: 'providers/overview' },
      { title: 'API keys', slug: 'providers/api-key-auth' },
      { title: 'Browser sign-in', slug: 'providers/oauth-auth' },
      { title: 'Custom providers', slug: 'providers/custom-providers' },
      { title: 'Virtual models', slug: 'providers/virtual-models' },
      { title: 'Approvals and permissions', slug: 'configuration/approvals-permissions' },
      { title: 'Thinking levels', slug: 'configuration/thinking-levels' },
      { title: 'Project instructions', slug: 'extending/agents-md' },
      { title: 'Skills', slug: 'extending/skills-system' },
      { title: 'MCP connections', slug: 'configuration/mcp' },
      { title: 'Extensions', slug: 'extending/plugins' },
      { title: 'Project actions', slug: 'configuration/project-actions' },
      { title: 'Settings', slug: 'configuration/app-settings' },
      { title: 'Project configuration', slug: 'configuration/per-project-config' },
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
      { title: 'Usage statistics', slug: 'configuration/usage-statistics' },
    ],
  },
  {
    // ADR 0061: exact facts to look up. Guides link here instead of repeating these lists.
    title: 'Reference',
    items: [
      { title: 'Settings', slug: 'reference/settings' },
      { title: 'Configuration files', slug: 'reference/configuration-files' },
      { title: 'Keyboard shortcuts', slug: 'getting-started/keyboard-shortcuts' },
      { title: 'Hive actions and states', slug: 'reference/hive' },
      { title: 'MCP', slug: 'configuration/mcp-reference' },
      { title: 'Project actions', slug: 'configuration/project-actions-reference' },
      { title: 'Scheduled tasks', slug: 'using-openwaggle/scheduled-tasks-reference' },
      { title: 'Environment variables', slug: 'reference/environment-variables' },
      { title: 'Data and file locations', slug: 'reference/data-locations' },
      { title: 'Usage statistics fields', slug: 'reference/usage-statistics-fields' },
    ],
  },
]

export const developerDocsNav: NavSection[] = [
  {
    title: 'Developer docs',
    items: [
      { title: 'Build from source', slug: 'developer-guide/building-from-source' },
      { title: 'Contributing', slug: 'developer-guide/contributing' },
      { title: 'Architecture', slug: 'developer-guide/architecture' },
      { title: 'Pi runtime', slug: 'developer-workflow/pi-runtime' },
      { title: 'Command line', slug: 'developer-workflow/command-line' },
      { title: 'Hive CLI', slug: 'developer-workflow/hive-cli' },
      { title: 'Token benchmarks', slug: 'using-openwaggle/token-benchmarks' },
      { title: 'Build an extension', slug: 'extending/openwaggle-extensions' },
      { title: 'Add to the Session Summary', slug: 'extending/extension-session-summary' },
      { title: 'Extension manifest', slug: 'extending/extension-manifest' },
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
]

export function isDeveloperDoc(slug: string): boolean {
  return developerDocsNav.some((section) =>
    section.items.some((item) => slug === item.slug || slug.startsWith(`${item.slug}/`)),
  )
}

export function flatNavItems(): NavItem[] {
  return [...docsNav, ...developerDocsNav].flatMap((section) => section.items)
}

export function getPrevNext(currentSlug: string) {
  const sections = isDeveloperDoc(currentSlug) ? developerDocsNav : docsNav
  const flat = sections.flatMap((section) => section.items)
  const index = flat.findIndex((item) => item.slug === currentSlug)
  return {
    prev: index > 0 ? flat[index - 1] : null,
    next: index >= 0 && index < flat.length - 1 ? flat[index + 1] : null,
  }
}
