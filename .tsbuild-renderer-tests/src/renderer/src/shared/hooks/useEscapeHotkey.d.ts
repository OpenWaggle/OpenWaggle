interface EscapeHotkeyOptions {
    readonly enabled?: boolean;
}
export declare function useEscapeHotkey(onEscape: () => void, options?: EscapeHotkeyOptions): void;
export {};
