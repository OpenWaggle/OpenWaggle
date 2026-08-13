import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey';
import { useUIStore } from '@/shell/ui-store';
import { useCommandPaletteItems } from '../hooks/useCommandPaletteItems';
import { useCommandPaletteKeyboard } from '../hooks/useCommandPaletteKeyboard';
import { CommandPaletteList } from './CommandPaletteList';
import { CommandPaletteSearch } from './CommandPaletteSearch';
export function CommandPalette({ slashSkills, onSelectSkill, onStartWaggle, onOpenSessionTree, onForkToNewSession, onCloneToNewSession, }) {
    const closeCommandPalette = useUIStore((s) => s.closeCommandPalette);
    const [query, setQuery] = useState('');
    const [highlightIndex, setHighlightIndex] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);
    const items = useCommandPaletteItems({
        query,
        slashSkills,
        onSelectSkill,
        onStartWaggle,
        onOpenSessionTree,
        onForkToNewSession,
        onCloneToNewSession,
    });
    const handleKeyDown = useCommandPaletteKeyboard({
        items,
        highlightIndex,
        setHighlightIndex,
        listRef,
    });
    useEffect(() => {
        inputRef.current?.focus();
    }, []);
    useEscapeHotkey(closeCommandPalette);
    function handleQueryChange(nextQuery) {
        setQuery(nextQuery);
        setHighlightIndex(0);
    }
    return (_jsxs("div", { className: "w-full overflow-hidden rounded-xl border border-[#2a2f3a] bg-[#161a20]", children: [_jsx(CommandPaletteSearch, { inputRef: inputRef, query: query, onKeyDown: handleKeyDown, onQueryChange: handleQueryChange }), _jsx(CommandPaletteList, { items: items, highlightIndex: highlightIndex, onHighlightIndexChange: setHighlightIndex, listRef: listRef })] }));
}
