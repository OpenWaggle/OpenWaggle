import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMExportOutput,
  type EditorConfig,
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

  static override getType() {
    return 'skill-mention'
  }

  static override clone(node: SkillMentionNode) {
    return new SkillMentionNode(node.__skillId, node.__skillName, node.__key)
  }

  constructor(skillId: string, skillName: string, key?: NodeKey) {
    super(key)
    this.__skillId = skillId
    this.__skillName = skillName
  }

  override createDOM(_config: EditorConfig) {
    const span = document.createElement('span')
    span.style.display = 'inline'
    return span
  }

  override updateDOM() {
    return false
  }

  override exportDOM(): DOMExportOutput {
    const element = document.createElement('span')
    element.textContent = `/${this.__skillId}`
    return { element }
  }

  static override importDOM() {
    return null
  }

  static override importJSON(serializedNode: SerializedSkillMentionNode) {
    return $createSkillMentionNode(serializedNode.skillId, serializedNode.skillName)
  }

  override exportJSON() {
    return {
      ...super.exportJSON(),
      skillId: this.__skillId,
      skillName: this.__skillName,
      type: 'skill-mention',
      version: 1,
    }
  }

  override getTextContent() {
    return `/${this.__skillId}`
  }

  override isInline() {
    return true
  }

  override decorate(): ReactNode {
    return createElement(SkillMentionChip, {
      skillId: this.__skillId,
      skillName: this.__skillName,
    })
  }
}

export function $createSkillMentionNode(skillId: string, skillName: string): SkillMentionNode {
  return $applyNodeReplacement(new SkillMentionNode(skillId, skillName))
}
