import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical'
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { URLMentionChip } from './URLMentionChip'

export type SerializedURLMentionNode = Spread<{ url: string }, SerializedLexicalNode>

export class URLMentionNode extends DecoratorNode<ReactNode> {
  __url: string

  static getType(): string {
    return 'url-mention'
  }

  static clone(node: URLMentionNode): URLMentionNode {
    return new URLMentionNode(node.__url, node.__key)
  }

  constructor(url: string, key?: NodeKey) {
    super(key)
    this.__url = url
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span')
    span.style.display = 'inline'
    return span
  }

  updateDOM(): false {
    return false
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('span')
    element.textContent = this.__url
    return { element }
  }

  static importDOM(): null {
    return null
  }

  static importJSON(serializedNode: SerializedURLMentionNode): URLMentionNode {
    return $createURLMentionNode(serializedNode.url)
  }

  exportJSON(): SerializedURLMentionNode {
    return {
      ...super.exportJSON(),
      url: this.__url,
      type: 'url-mention',
      version: 1,
    }
  }

  getTextContent(): string {
    return this.__url
  }

  isInline(): true {
    return true
  }

  decorate(): ReactNode {
    return createElement(URLMentionChip, { url: this.__url })
  }
}

export function $createURLMentionNode(url: string): URLMentionNode {
  return $applyNodeReplacement(new URLMentionNode(url))
}

export function $isURLMentionNode(node: LexicalNode | null | undefined): node is URLMentionNode {
  return node instanceof URLMentionNode
}
