type TitleBarProps = {
  alwaysOnTop: boolean;
  pinDisabled: boolean;
  onTogglePin: () => void;
  onOpenLibrary: () => void;
  onMinimize: () => void;
  onClose: () => void;
};

export function TitleBar({ alwaysOnTop, pinDisabled, onTogglePin, onOpenLibrary, onMinimize, onClose }: TitleBarProps) {
  return <header className="titlebar" data-testid="titlebar">
    <span className="titlebar-name">Referenzio</span>
    <div className="titlebar-controls">
      <button type="button" aria-label="Toggle always on top" aria-pressed={alwaysOnTop} disabled={pinDisabled} onClick={onTogglePin}>Pin</button>
      <button type="button" aria-label="Open library folder" onClick={onOpenLibrary}>Library</button>
      <button type="button" aria-label="Minimize" onClick={onMinimize}>—</button>
      <button type="button" aria-label="Close" onClick={onClose}>×</button>
    </div>
  </header>;
}
