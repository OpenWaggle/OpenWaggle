export declare function ExtensionsSectionHeading({ projectCount, loading, onRefresh, }: {
    readonly projectCount: number;
    readonly loading: boolean;
    readonly onRefresh: () => void;
}): import("node_modules/@types/react").JSX.Element;
export declare function ExtensionsErrorAlert({ message }: {
    readonly message: string | null;
}): import("node_modules/@types/react").JSX.Element | null;
