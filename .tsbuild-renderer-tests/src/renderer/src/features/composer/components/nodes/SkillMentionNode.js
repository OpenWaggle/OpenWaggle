import { $applyNodeReplacement, DecoratorNode, } from 'lexical';
import { createElement } from 'react';
import { SkillMentionChip } from './SkillMentionChip';
export class SkillMentionNode extends DecoratorNode {
    __skillId;
    __skillName;
    static getType() {
        return 'skill-mention';
    }
    static clone(node) {
        return new SkillMentionNode(node.__skillId, node.__skillName, node.__key);
    }
    constructor(skillId, skillName, key) {
        super(key);
        this.__skillId = skillId;
        this.__skillName = skillName;
    }
    createDOM(_config) {
        const span = document.createElement('span');
        span.style.display = 'inline';
        return span;
    }
    updateDOM() {
        return false;
    }
    exportDOM() {
        const element = document.createElement('span');
        element.textContent = `/${this.__skillId}`;
        return { element };
    }
    static importDOM() {
        return null;
    }
    static importJSON(serializedNode) {
        return $createSkillMentionNode(serializedNode.skillId, serializedNode.skillName);
    }
    exportJSON() {
        return {
            ...super.exportJSON(),
            skillId: this.__skillId,
            skillName: this.__skillName,
            type: 'skill-mention',
            version: 1,
        };
    }
    getTextContent() {
        return `/${this.__skillId}`;
    }
    isInline() {
        return true;
    }
    decorate() {
        return createElement(SkillMentionChip, {
            skillId: this.__skillId,
            skillName: this.__skillName,
        });
    }
}
export function $createSkillMentionNode(skillId, skillName) {
    return $applyNodeReplacement(new SkillMentionNode(skillId, skillName));
}
