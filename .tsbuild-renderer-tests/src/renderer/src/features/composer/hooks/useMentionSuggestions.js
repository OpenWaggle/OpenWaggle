import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { api } from '@/shared/lib/ipc';
import { createRendererLogger } from '@/shared/lib/logger';
const logger = createRendererLogger('mention-typeahead');
export function useMentionSuggestions({ projectPath, query }) {
    const [suggestions, setSuggestions] = useState([]);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const deferredQuery = useDeferredValue(query);
    const queryVersionRef = useRef(0);
    useEffect(() => {
        if (deferredQuery === null || !projectPath || typeof api.suggestFiles !== 'function') {
            setSuggestions([]);
            return;
        }
        queryVersionRef.current += 1;
        const version = queryVersionRef.current;
        void api
            .suggestFiles(projectPath, deferredQuery)
            .then((results) => {
            if (version !== queryVersionRef.current)
                return;
            setSuggestions(results);
            setHighlightIndex(0);
        })
            .catch((error) => {
            if (version !== queryVersionRef.current)
                return;
            logger.warn('File suggestion failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            setSuggestions([]);
        });
    }, [deferredQuery, projectPath]);
    return {
        suggestions,
        highlightIndex,
        setHighlightIndex,
        clearSuggestions: () => setSuggestions([]),
    };
}
