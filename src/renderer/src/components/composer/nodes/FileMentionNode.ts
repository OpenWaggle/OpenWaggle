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
import { FileMentionChip } from './FileMentionChip'

export type SerializedFileMentionNode = Spread<
  { mentionPath: string; mentionBasename: string },
  SerializedLexicalNode
>

export class FileMentionNode extends DecoratorNode<ReactNode> {
  __path: string
  __basename: string

  static getType(): string {
    return 'file-mention'
  }

  static clone(node: FileMentionNode): FileMentionNode {
    return new FileMentionNode(node.__path, node.__basename, node.__key)
  }

  constructor(filePath: string, basename: string, key?: NodeKey) {
    super(key)
    this.__path = filePath
    this.__basename = basename
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
    element.textContent = `@${this.__path}`
    return { element }
  }

  static importJSON(serializedNode: SerializedFileMentionNode): FileMentionNode {
    return $createFileMentionNode(serializedNode.mentionPath, serializedNode.mentionBasename)
  }

  exportJSON(): SerializedFileMentionNode {
    return {
      ...super.exportJSON(),
      mentionPath: this.__path,
      mentionBasename: this.__basename,
      type: 'file-mention',
      version: 1,
    }
  }

  getTextContent(): string {
    return `@${this.__path}`
  }

  isInline(): true {
    return true
  }

  decorate(): ReactNode {
    return createElement(FileMentionChip, {
      path: this.__path,
      basename: this.__basename,
    })
  }
}

export function $createFileMentionNode(filePath: string, basename: string): FileMentionNode {
  return $applyNodeReplacement(new FileMentionNode(filePath, basename))
}

export function $isFileMentionNode(node: LexicalNode | null | undefined): node is FileMentionNode {
  return node instanceof FileMentionNode
}
