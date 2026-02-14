import { useEffect } from 'react';
import './KeyboardShortcutsDialog.css';

interface KeyboardShortcutsDialogProps {
  onClose: () => void;
}

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutCategory {
  name: string;
  shortcuts: Shortcut[];
}

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const mod = isMac ? '⌘' : 'Ctrl';

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    name: 'Navigation',
    shortcuts: [
      { keys: [mod, 'K'], description: 'Open Quick Switcher' },
      { keys: [mod, '\\'], description: 'Toggle channel sidebar' },
      { keys: [mod, 'B'], description: 'Toggle member sidebar' },
      { keys: [mod, '?'], description: 'Show keyboard shortcuts' },
    ],
  },
  {
    name: 'Messaging',
    shortcuts: [
      { keys: ['Enter'], description: 'Send message' },
      { keys: ['Shift', 'Enter'], description: 'New line in message' },
      { keys: ['↑'], description: 'Edit last message (empty input)' },
      { keys: ['Escape'], description: 'Close dialog / cancel edit' },
    ],
  },
];

export function KeyboardShortcutsDialog({ onClose }: KeyboardShortcutsDialogProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-header">
          <h2>Keyboard Shortcuts</h2>
          <button className="shortcuts-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="shortcuts-body">
          {SHORTCUT_CATEGORIES.map((cat) => (
            <div key={cat.name} className="shortcuts-category">
              <h3 className="shortcuts-category-name">{cat.name}</h3>
              {cat.shortcuts.map((shortcut, i) => (
                <div key={i} className="shortcuts-row">
                  <span className="shortcuts-description">
                    {shortcut.description}
                  </span>
                  <span className="shortcuts-keys">
                    {shortcut.keys.map((key, j) => (
                      <span key={j}>
                        <kbd className="shortcuts-kbd">{key}</kbd>
                        {j < shortcut.keys.length - 1 && (
                          <span className="shortcuts-plus">+</span>
                        )}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
