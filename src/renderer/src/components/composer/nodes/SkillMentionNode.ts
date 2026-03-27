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
import { SkillMentionChip } from './SkillMentionChip'

export type SerializedSkillMentionNode = Spread<
  { skillId: string; skillName: string },
  SerializedLexicalNode
>

export class SkillMentionNode extends DecoratorNode<ReactNode> {
  __skillId: string
  __skillName: string

  static getType(): string {
    return 'skill-mention'
  }

  static clone(node: SkillMentionNode): SkillMentionNode {
    return new SkillMentionNode(node.__skillId, node.__skillName, node.__key)
  }

  constructor(skillId: string, skillName: string, key?: NodeKey) {
    super(key)
    this.__skillId = skillId
    this.__skillName = skillName
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
    element.textContent = `/${this.__skillId}`
    return { element }
  }

  static importJSON(serializedNode: SerializedSkillMentionNode): SkillMentionNode {
    return $createSkillMentionNode(serializedNode.skillId, serializedNode.skillName)
  }

  exportJSON(): SerializedSkillMentionNode {
    return {
      ...super.exportJSON(),
      skillId: this.__skillId,
      skillName: this.__skillName,
      type: 'skill-mention',
      version: 1,
    }
  }

  getTextContent(): string {
    return `/${this.__skillId}`
  }

  isInline(): true {
    return true
  }

  decorate(): ReactNode {
    return createElement(SkillMentionChip, {
      skillId: this.__skillId,
      skillName: this.__skillName,
    })
  }
}

export function $createSkillMentionNode(skillId: string, skillName: string): SkillMentionNode {
  return $applyNodeReplacement(new SkillMentionNode(skillId, skillName))
}

export function $isSkillMentionNode(
  node: LexicalNode | null | undefined,
): node is SkillMentionNode {
  return node instanceof SkillMentionNode
}
