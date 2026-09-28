import { DEFAULT_DESCRIPTION, SITE_URL } from './seo';

export interface LlmsTxtSection {
  title: string;
  pages: readonly { title: string; path: string; description?: string }[];
}

/** Renders an llms.txt index (https://llmstxt.org) so AI assistants can find the right docs page. */
export function buildLlmsTxt(sections: readonly LlmsTxtSection[]): string {
  const lines = [
    '# OpenWaggle',
    '',
    `> ${DEFAULT_DESCRIPTION}`,
    '',
    'OpenWaggle is built on Pi. Waggle pairs two agents that take turns on one task; a Hive is a Queen session that delegates work to Worker sessions. The agent can also write OpenWaggle extensions that add panels, commands, and tools, which install only after the user approves them.',
    '',
    `Download: ${SITE_URL}/docs/getting-started/installation/`,
    'Source: https://github.com/OpenWaggle/OpenWaggle',
  ];
  for (const section of sections) {
    lines.push('', `## ${section.title}`, '');
    for (const page of section.pages) {
      const url = new URL(page.path, SITE_URL).href;
      lines.push(page.description ? `- [${page.title}](${url}): ${page.description}` : `- [${page.title}](${url})`);
    }
  }
  return `${lines.join('\n')}\n`;
}
