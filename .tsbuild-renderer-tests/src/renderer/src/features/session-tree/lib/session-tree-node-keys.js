export function sessionTreeNodeKey(node) {
    return String(node.id);
}
export function sessionTreeParentKey(node) {
    return node.parentId ? String(node.parentId) : null;
}
