import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/shared/lib/ipc';
const FONT_SIZE = 14;
const TERMINAL_THEME = {
    background: '#0a0a0a',
    foreground: '#e5e5e5',
    cursor: '#f59e0b',
    selectionBackground: 'rgba(245, 158, 11, 0.3)',
    black: '#0a0a0a',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#f59e0b',
    blue: '#3b82f6',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#fbbf24',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: '#ffffff',
};
function createTerminal() {
    return new Terminal({
        theme: TERMINAL_THEME,
        fontSize: FONT_SIZE,
        fontFamily: '"SF Mono", "Fira Code", "JetBrains Mono", monospace',
        cursorBlink: true,
        allowProposedApi: true,
    });
}
function setTerminalReady(terminalIdRef, id, term, setTerminalStatus) {
    terminalIdRef.current = id;
    setTerminalStatus({ isReady: true, errorMessage: null });
    api.resizeTerminal(id, term.cols, term.rows);
}
function setTerminalError(error, setTerminalStatus) {
    setTerminalStatus({
        isReady: false,
        errorMessage: error instanceof Error ? error.message : 'Failed to open terminal.',
    });
}
export function useTerminalSession(projectPath) {
    const containerRef = useRef(null);
    const terminalIdRef = useRef(null);
    const [terminalStatus, setTerminalStatus] = useState({
        isReady: false,
        errorMessage: null,
    });
    useEffect(() => {
        if (!containerRef.current)
            return;
        let cleanedUp = false;
        const term = createTerminal();
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef.current);
        requestAnimationFrame(() => fitAddon.fit());
        const cwd = projectPath ?? '';
        // This effect owns the terminal it creates. Tracking the id in an
        // effect-scoped local (instead of reading terminalIdRef.current at cleanup)
        // keeps ownership unambiguous AND fixes a leak: if cleanup ran before
        // createTerminal resolved, the ref was still null and the terminal was never
        // closed (react-doctor/exhaustive-deps).
        let createdTerminalId = null;
        api
            .createTerminal(cwd)
            .then((id) => {
            createdTerminalId = id;
            if (cleanedUp) {
                void api.closeTerminal(id);
                return;
            }
            setTerminalReady(terminalIdRef, id, term, setTerminalStatus);
        })
            .catch((error) => {
            if (!cleanedUp)
                setTerminalError(error, setTerminalStatus);
        });
        const inputDispose = term.onData((data) => {
            if (terminalIdRef.current)
                api.writeTerminal(terminalIdRef.current, data);
        });
        const unsubscribe = api.onTerminalData((payload) => {
            if (payload.terminalId === terminalIdRef.current)
                term.write(payload.data);
        });
        const resizeObserver = new ResizeObserver(() => {
            fitAddon.fit();
            if (terminalIdRef.current) {
                api.resizeTerminal(terminalIdRef.current, term.cols, term.rows);
            }
        });
        resizeObserver.observe(containerRef.current);
        return () => {
            cleanedUp = true;
            inputDispose.dispose();
            unsubscribe();
            resizeObserver.disconnect();
            if (createdTerminalId)
                void api.closeTerminal(createdTerminalId);
            term.dispose();
        };
    }, [projectPath]);
    return { containerRef, terminalStatus };
}
