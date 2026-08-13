/** Pure passthrough — defined at module scope so it keeps a stable identity. */
declare function selectFolder(): Promise<string | null>;
/**
 * Hook for project folder selection.
 */
export declare function useProject(): {
    projectPath: string | null;
    selectFolder: typeof selectFolder;
    setProjectPath: (path: string | null) => Promise<void>;
};
export {};
