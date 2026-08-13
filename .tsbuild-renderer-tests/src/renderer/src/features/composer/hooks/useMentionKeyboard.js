import { COMMAND_PRIORITY_HIGH, KEY_DOWN_COMMAND } from 'lexical';
import { useEffect } from 'react';
export function useMentionKeyboard({ editor, isOpen, suggestions, highlightIndex, setHighlightIndex, onSelect, onClose, }) {
    useEffect(() => {
        if (!isOpen)
            return;
        return editor.registerCommand(KEY_DOWN_COMMAND, (event) => handleMentionKeyDown({
            event,
            suggestions,
            highlightIndex,
            setHighlightIndex,
            onSelect,
            onClose,
        }), COMMAND_PRIORITY_HIGH);
    }, [editor, isOpen, suggestions, highlightIndex, setHighlightIndex, onSelect, onClose]);
}
function handleMentionKeyDown({ event, suggestions, highlightIndex, setHighlightIndex, onSelect, onClose, }) {
    if (event.key === 'ArrowDown')
        return moveHighlight(event, setHighlightIndex, 1, suggestions.length);
    if (event.key === 'ArrowUp')
        return moveHighlight(event, setHighlightIndex, -1, suggestions.length);
    if (event.key === 'Enter' || event.key === 'Tab')
        return selectHighlighted(event, suggestions[highlightIndex], onSelect);
    if (event.key === 'Escape')
        return closeTypeahead(event, onClose);
    return false;
}
function moveHighlight(event, setHighlightIndex, delta, itemCount) {
    event.preventDefault();
    setHighlightIndex((currentIndex) => (currentIndex + delta + itemCount) % itemCount);
    return true;
}
function selectHighlighted(event, selected, onSelect) {
    event.preventDefault();
    if (selected)
        onSelect(selected);
    return true;
}
function closeTypeahead(event, onClose) {
    event.preventDefault();
    onClose();
    return true;
}
