import { DecoratorNode, type DOMExportOutput, type EditorConfig, type NodeKey, type SerializedLexicalNode, type Spread } from 'lexical';
import type { ReactNode } from 'react';
export type SerializedSkillMentionNode = Spread<{
    skillId: string;
    skillName: string;
}, SerializedLexicalNode>;
export declare class SkillMentionNode extends DecoratorNode<ReactNode> {
    __skillId: string;
    __skillName: string;
    static getType(): string;
    static clone(node: SkillMentionNode): SkillMentionNode;
    constructor(skillId: string, skillName: string, key?: NodeKey);
    createDOM(_config: EditorConfig): HTMLSpanElement;
    updateDOM(): boolean;
    exportDOM(): DOMExportOutput;
    static importDOM(): null;
    static importJSON(serializedNode: SerializedSkillMentionNode): SkillMentionNode;
    exportJSON(): {
        skillId: string;
        skillName: string;
        type: string;
        version: number;
        $?: Record<string, unknown>;
    };
    getTextContent(): string;
    isInline(): boolean;
    decorate(): ReactNode;
}
export declare function $createSkillMentionNode(skillId: string, skillName: string): SkillMentionNode;
