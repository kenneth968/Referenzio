import type { UserError } from '../../shared/contracts';

type NoticeCenterProps = {
  hasDocument: boolean;
  loadState: 'loading' | 'ready' | 'recovered' | 'error';
  saveState: 'saved' | 'saving' | 'unsaved';
  isClosing: boolean;
  importProgress: { completed: number; total: number } | null;
  recoveryVisible: boolean;
  recoveryMessage: string | null;
  shortcutMessage: string | null;
  errors: UserError[];
  onRetrySave: () => void;
  onErrorAction: (error: UserError) => void;
  onDismissShortcut: () => void;
  onDismissRecovery: () => void;
};

const actionLabels: Record<UserError['action'], string> = {
  'retry-load': 'Retry load',
  'retry-save': 'Retry save',
  'retry-close': 'Retry close',
  'retry-open-library': 'Retry open library',
  'open-library': 'Open library folder',
  dismiss: 'Dismiss',
};

export function NoticeCenter({ hasDocument, loadState, saveState, isClosing, importProgress, recoveryVisible, recoveryMessage, shortcutMessage, errors, onRetrySave, onErrorAction, onDismissShortcut, onDismissRecovery }: NoticeCenterProps) {
  const status = isClosing ? 'Finishing imports and saving…'
    : importProgress ? `Importing ${importProgress.completed} of ${importProgress.total}…`
      : !hasDocument && loadState === 'loading' ? 'Loading board…' : null;

  return <section className="notice-center" aria-label="Board status">
    {status ? <p role="status" className="notice-status">{status}</p> : hasDocument ? (
      saveState === 'unsaved'
        ? <p role="status" className="notice-status">Unsaved — <button type="button" onClick={onRetrySave}>Retry save</button></p>
        : <p role="status" className="notice-status">{saveState === 'saving' ? 'Saving…' : 'Saved'}</p>
    ) : null}
    {recoveryVisible && recoveryMessage ? <div role="alert" className="notice-warning">{recoveryMessage} <button type="button" onClick={onDismissRecovery}>Dismiss</button></div> : null}
    {shortcutMessage ? <div role="alert" className="notice-warning">{shortcutMessage} <button type="button" onClick={onDismissShortcut}>Dismiss</button></div> : null}
    {errors.map((current, index) => <div role="alert" className="notice-error" key={`${current.code}-${index}`}>
      <span>{current.message}</span> <button type="button" onClick={() => onErrorAction(current)}>{actionLabels[current.action]}</button>
    </div>)}
  </section>;
}
