import { $createTextNode, $getSelection, $isRangeSelection, $isTextNode, } from 'lexical';
import { $createFileMentionNode } from '../components/nodes/FileMentionNode';
/**
 * Returns the mention-commit handler. Deliberately a plain function, not a
 * useEffectEvent: the result is passed as a prop to the dropdown (and to the
 * keyboard hook), and useEffectEvent results must only be called from Effects in
 * the component that created them (react-doctor/rules-of-hooks).
 */
export function useMentionSelection({ editor, match, onClose }) {
    return (item) => {
        editor.update(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection) || !match)
                return;
            const anchorNode = selection.anchor.getNode();
            if (!$isTextNode(anchorNode))
                return;
            const textContent = anchorNode.getTextContent();
            const beforeAt = textContent.slice(0, match.startOffset);
            const afterQuery = textContent.slice(match.startOffset + 1 + match.query.length);
            const mentionNode = $createFileMentionNode(item.path, item.basename);
            const trailingText = $createTextNode(`${afterQuery} `);
            anchorNode.setTextContent(beforeAt);
            anchorNode.insertAfter(mentionNode);
            mentionNode.insertAfter(trailingText);
            trailingText.select();
        });
        onClose();
        editor.focus();
    };
}
