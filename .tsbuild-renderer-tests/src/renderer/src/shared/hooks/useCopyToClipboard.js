import { useEffect, useRef, useState } from 'react';
import { api } from '@/shared/lib/ipc';
const FEEDBACK_DURATION_MS = 2000;
export function useCopyToClipboard() {
    const [copied, setCopied] = useState(false);
    const timerRef = useRef(null);
    useEffect(() => {
        return () => {
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current);
            }
        };
    }, []);
    function copy(text) {
        api.copyToClipboard(text);
        setCopied(true);
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(() => {
            setCopied(false);
            timerRef.current = null;
        }, FEEDBACK_DURATION_MS);
    }
    return { copied, copy };
}
