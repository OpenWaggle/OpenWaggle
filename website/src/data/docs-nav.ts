export interface NavItem {
  title: string;
  slug: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const docsNav: NavSection[] = [
  {
    title: 'Getting Started',
    items: [
      { title: 'Installation', slug: 'getting-started/installation' },
      { title: 'First Run', slug: 'getting-started/first-run' },
      { title: 'Interface Overview', slug: 'getting-started/interface-overview' },
      { title: 'Keyboard Shortcuts', slug: 'getting-started/keyboard-shortcuts' },
    ],
  },
  {
    title: 'Using OpenWaggle',
    items: [
      { title: 'Chat & Tools', slug: 'using-openwaggle/chat-and-tools' },
      { title: 'Waggle Mode', slug: 'using-openwaggle/waggle-mode' },
      { title: 'Attachments & Voice', slug: 'using-openwaggle/attachments-voice' },
      { title: 'Plan Mode', slug: 'using-openwaggle/plan-mode' },
    ],
  },
  {
    title: 'Providers',
    items: [
      { title: 'Overview', slug: 'providers/overview' },
      { title: 'Anthropic', slug: 'providers/anthropic' },
      { title: 'OpenAI', slug: 'providers/openai' },
      { title: 'Google Gemini', slug: 'providers/google-gemini' },
      { title: 'Grok', slug: 'providers/grok' },
      { title: 'OpenRouter', slug: 'providers/openrouter' },
      { title: 'Ollama', slug: 'providers/ollama' },
    ],
  },
  {
    title: 'Developer Workflow',
    items: [
      { title: 'Git Integration', slug: 'developer-workflow/git-integration' },
      { title: 'Built-in Terminal', slug: 'developer-workflow/built-in-terminal' },
      { title: 'Execution Modes', slug: 'developer-workflow/execution-modes' },
    ],
  },
  {
    title: 'Extending',
    items: [
      { title: 'Skills System', slug: 'extending/skills-system' },
      { title: 'MCP Servers', slug: 'extending/mcp-servers' },
      { title: 'AGENTS.md', slug: 'extending/agents-md' },
      { title: 'Creating Custom Skills', slug: 'extending/creating-custom-skills' },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { title: 'App Settings', slug: 'configuration/app-settings' },
      { title: 'Per-Project Config', slug: 'configuration/per-project-config' },
      { title: 'Quality Presets', slug: 'configuration/quality-presets' },
      { title: 'Security & Privacy', slug: 'configuration/security-privacy' },
    ],
  },
  {
    title: 'Developer Guide',
    items: [
      { title: 'Architecture', slug: 'developer-guide/architecture' },
      { title: 'Contributing', slug: 'developer-guide/contributing' },
      { title: 'Building from Source', slug: 'developer-guide/building-from-source' },
    ],
  },
];

export function flatNavItems(): NavItem[] {
  return docsNav.flatMap((section) => section.items);
}

export function getPrevNext(currentSlug: string) {
  const flat = flatNavItems();
  const index = flat.findIndex((item) => item.slug === currentSlug);
  return {
    prev: index > 0 ? flat[index - 1] : null,
    next: index < flat.length - 1 ? flat[index + 1] : null,
  };
}
