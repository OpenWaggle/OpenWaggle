interface BranchPickerSearchProps {
    readonly query: string;
    readonly isBranchActionRunning: boolean;
    readonly onQueryChange: (query: string) => void;
}
export declare function BranchPickerSearch({ query, isBranchActionRunning, onQueryChange, }: BranchPickerSearchProps): import("node_modules/@types/react").JSX.Element;
export {};
