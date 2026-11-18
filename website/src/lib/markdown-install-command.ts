import { substituteInstallPlaceholders } from './install-command'

// Only the fields this plugin reads. `@types/mdast` is not a website dependency, so it is not imported.
interface MdastNode {
  type: string
  value?: string
  url?: string
  children?: MdastNode[]
}

interface MarkdownFile {
  path?: string
}

/**
 * Remark plugin: fills in the install placeholders (`install-command.ts`) in code blocks, inline
 * code, text and link targets, so the rendered page, and the text its Copy button copies, show the
 * real command. An unknown placeholder fails the build with the page path.
 */
export function remarkInstallCommand() {
  return (tree: MdastNode, file: MarkdownFile) => {
    const visit = (node: MdastNode) => {
      if (typeof node.value === 'string') node.value = substituteInstallPlaceholders(node.value)
      if (typeof node.url === 'string') node.url = substituteInstallPlaceholders(node.url)
      for (const child of node.children ?? []) visit(child)
    }
    try {
      visit(tree)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${file.path ?? 'A Markdown file'}: ${message}`, { cause: error })
    }
  }
}
