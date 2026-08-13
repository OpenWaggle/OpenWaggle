import { match } from '@diegogbrisa/ts-match';
export function useCommandPaletteKeyboard({ items, highlightIndex, setHighlightIndex, listRef, }) {
    function scrollHighlightedIntoView() {
        requestAnimationFrame(() => {
            const highlighted = listRef.current?.querySelector('[data-highlighted="true"]');
            highlighted?.scrollIntoView({ block: 'nearest' });
        });
    }
    function moveHighlight(delta) {
        if (items.length === 0)
            return;
        setHighlightIndex((currentIndex) => nextHighlightIndex(currentIndex, delta, items.length));
        scrollHighlightedIntoView();
    }
    return (event) => {
        match(event.key)
            .with('ArrowDown', () => {
            event.preventDefault();
            moveHighlight(1);
        })
            .with('ArrowUp', () => {
            event.preventDefault();
            moveHighlight(-1);
        })
            .with('Enter', () => {
            const selectedItem = items[highlightIndex];
            if (!selectedItem)
                return;
            event.preventDefault();
            selectedItem.action();
        })
            .otherwise(() => undefined);
    };
}
function nextHighlightIndex(currentIndex, delta, itemCount) {
    if (delta === 1)
        return (currentIndex + 1) % itemCount;
    return currentIndex === 0 ? itemCount - 1 : currentIndex - 1;
}
