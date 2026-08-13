interface UseCopyToClipboardResult {
    copied: boolean;
    copy: (text: string) => void;
}
export declare function useCopyToClipboard(): UseCopyToClipboardResult;
export {};
