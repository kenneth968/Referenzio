import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Asset, BoardDocument, Result, UserError } from '../shared/contracts';
import { emptyBoard } from '../shared/board';
import App from './App';

vi.mock('./BoardCanvas', () => ({
  BoardCanvas: ({ onClearSelection }: { onClearSelection: () => void }) => (
    <div data-testid="board-canvas" onPointerDown={onClearSelection} />
  ),
}));

const asset = (id = '11111111-1111-4111-8111-111111111111'): Asset => ({
  id, filename: `${id}.png`, mediaType: 'image/png', pixelWidth: 100, pixelHeight: 50, byteSize: 100,
  importedAt: '2026-09-07T00:00:00.000Z',
});
const error = (code: string, action: UserError['action'], message = code): UserError => ({ code, action, message });

function installBridge(document: BoardDocument = emptyBoard()) {
  const errors: Array<(value: UserError) => void> = [];
  window.referenzio = {
    loadBoard: vi.fn().mockResolvedValue({ ok: true, value: { document, recovery: 'empty', recoveryMessage: null, missingAssetIds: [] } }),
    getRuntimeStatus: vi.fn().mockResolvedValue({ ok: true, value: { alwaysOnTop: false, shortcut: { registered: true, message: null } } }),
    pasteClipboardImage: vi.fn().mockResolvedValue({ ok: false, error: error('EMPTY_CLIPBOARD', 'dismiss', 'Copy an image, then paste it onto the canvas.') }),
    importDroppedImages: vi.fn().mockResolvedValue({ ok: true, value: { imported: [], rejected: [] } }),
    saveBoard: vi.fn().mockImplementation(async (value: BoardDocument): Promise<Result<{ revision: number }>> => ({ ok: true, value: { revision: value.revision } })),
    setPinned: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    openLibraryFolder: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    minimizeWindow: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    closeWindow: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    onShortcutStatus: vi.fn(() => vi.fn()),
    onMainError: vi.fn((listener) => { errors.push(listener); return vi.fn(); }),
    onFlushRequest: vi.fn(() => vi.fn()),
  };
  return { errors };
}

function dropEventWith(files: File[], point = { clientX: 200, clientY: 120 }) {
  return { dataTransfer: { files }, ...point };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('App', () => {
  it.each([
    ['empty', 'Board snapshots could not be recovered. Open the library to inspect the preserved files.'],
    ['backup', 'Recovered the board from its backup copy, but the primary snapshot still needs repair.'],
  ] as const)('shows the actual %s recovery outcome', async (recovery, recoveryMessage) => {
    installBridge();
    vi.mocked(window.referenzio.loadBoard).mockResolvedValue({ ok: true, value: {
      document: emptyBoard(), recovery, recoveryMessage, missingAssetIds: [],
    } });
    render(<App />);
    expect(await screen.findByText(recoveryMessage)).toBeVisible();
    expect(screen.queryByText('The board was recovered from a backup.')).not.toBeInTheDocument();
  });
  it('focuses the ready canvas and pastes only while it owns focus', async () => {
    installBridge();
    const user = userEvent.setup();
    render(<App />);
    const host = await screen.findByTestId('canvas-host');
    await waitFor(() => expect(host).toHaveFocus());

    await user.keyboard('{Control>}v{/Control}');
    await waitFor(() => expect(window.referenzio.pasteClipboardImage).toHaveBeenCalledOnce());
    expect(await screen.findByText('Copy an image, then paste it onto the canvas.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Open library folder' }));
    await user.keyboard('{Control>}v{/Control}');
    expect(window.referenzio.pasteClipboardImage).toHaveBeenCalledOnce();
  });

  it('accepts an unshifted uppercase Ctrl+V event but ignores Ctrl+Shift+V', async () => {
    installBridge();
    render(<App />);
    const host = await screen.findByTestId('canvas-host');
    await waitFor(() => expect(host).toHaveFocus());

    fireEvent.keyDown(host, { key: 'V', ctrlKey: true });
    await waitFor(() => expect(window.referenzio.pasteClipboardImage).toHaveBeenCalledOnce());
    fireEvent.keyDown(host, { key: 'v', ctrlKey: true, shiftKey: true });
    expect(window.referenzio.pasteClipboardImage).toHaveBeenCalledOnce();
  });

  it('converts a multi-file drop at the host-relative point and shows partial rejection feedback', async () => {
    installBridge();
    vi.mocked(window.referenzio.importDroppedImages).mockResolvedValue({
      ok: true, value: { imported: [asset()], rejected: [{ sourceName: 'bad.gif', code: 'UNSUPPORTED', message: 'GIF files are not supported.' }] },
    });
    render(<App />);
    const host = await screen.findByTestId('canvas-host');
    Object.defineProperty(host, 'clientWidth', { value: 400 });
    Object.defineProperty(host, 'clientHeight', { value: 300 });
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ x: 50, y: 40, left: 50, top: 40, right: 450, bottom: 340, width: 400, height: 300, toJSON: () => ({}) });
    fireEvent.drop(host, dropEventWith([new File(['ok'], 'ok.png'), new File(['bad'], 'bad.gif')]));

    await waitFor(() => expect(window.referenzio.importDroppedImages).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: 'ok.png' }), expect.objectContaining({ name: 'bad.gif' }),
    ])));
    expect(await screen.findByRole('alert')).toHaveTextContent('bad.gif: GIF files are not supported.');
  });

  it('renders native controls, disables selection controls, and surfaces close failure once', async () => {
    const events = installBridge();
    render(<App />);
    await screen.findByTestId('canvas-host');
    const pin = screen.getByRole('button', { name: 'Toggle always on top' });
    await waitFor(() => expect(pin).toBeEnabled());
    expect(pin).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Send backward' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Fit board' })).toBeEnabled();
    fireEvent.click(pin);
    expect(window.referenzio.setPinned).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(window.referenzio.minimizeWindow).toHaveBeenCalledOnce();
    expect(window.referenzio.closeWindow).toHaveBeenCalledOnce();

    act(() => events.errors[0](error('CLOSE_FAILED', 'retry-close', 'Could not close the window.')));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not close the window.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry close' }));
    expect(window.referenzio.closeWindow).toHaveBeenCalledTimes(2);
  });
});
