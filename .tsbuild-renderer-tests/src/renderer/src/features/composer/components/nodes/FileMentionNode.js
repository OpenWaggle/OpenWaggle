import { $applyNodeReplacement, DecoratorNode, } from 'lexical';
import { createElement } from 'react';
import { FileMentionChip } from './FileMentionChip';
export class FileMentionNode extends DecoratorNode {
    __path;
    __basename;
    static getType() {
        return 'file-mention';
    }
    static clone(node) {
        return new FileMentionNode(node.__path, node.__basename, node.__key);
    }
    constructor(filePath, basename, key) {
        super(key);
        this.__path = filePath;
        this.__basename = basename;
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
        element.textContent = `@${this.__path}`;
        return { element };
    }
    static importDOM() {
        return null;
    }
    static importJSON(serializedNode) {
        return $createFileMentionNode(serializedNode.mentionPath, serializedNode.mentionBasename);
    }
    exportJSON() {
        return {
            ...super.exportJSON(),
            mentionPath: this.__path,
            mentionBasename: this.__basename,
            type: 'file-mention',
            version: 1,
        };
    }
    getTextContent() {
        return `@${this.__path}`;
    }
    isInline() {
        return true;
    }
    decorate() {
        return createElement(FileMentionChip, {
            path: this.__path,
            basename: this.__basename,
        });
    }
}
export function $createFileMentionNode(filePath, basename) {
    return $applyNodeReplacement(new FileMentionNode(filePath, basename));
}
