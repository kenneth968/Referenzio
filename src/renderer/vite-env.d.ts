declare module '*.css';

interface Window {
  referenzio: {
    loadBoard(): Promise<import('../shared/contracts').Result<import('../shared/contracts').LoadBoardResult>>;
    getRuntimeStatus(): Promise<import('../shared/contracts').Result<import('../shared/contracts').RuntimeStatus>>;
    pasteClipboardImage(): Promise<import('../shared/contracts').Result<import('../shared/contracts').Asset>>;
    importDroppedImages(files: File[]): Promise<import('../shared/contracts').Result<import('../shared/contracts').ImportBatchResult>>;
    saveBoard(document: import('../shared/contracts').BoardDocument): Promise<import('../shared/contracts').Result<{ revision: number }>>;
    setPinned(value: boolean): Promise<import('../shared/contracts').Result<void>>;
    openLibraryFolder(): Promise<import('../shared/contracts').Result<void>>;
    minimizeWindow(): Promise<import('../shared/contracts').Result<void>>;
    closeWindow(): Promise<import('../shared/contracts').Result<void>>;
    onShortcutStatus(listener: (status: import('../shared/contracts').ShortcutStatus) => void): () => void;
    onMainError(listener: (error: import('../shared/contracts').UserError) => void): () => void;
    onFlushRequest(listener: () => Promise<import('../shared/contracts').Result<{ revision: number }>>): () => void;
  };
}
