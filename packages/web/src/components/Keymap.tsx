import { useStore } from '../store';
import { Overlay } from './Overlay';

const ROWS: [string, string[]][] = [
  ['Jump to file', ['⌘K']], ['Search repo', ['⌘⇧F']], ['PR overview', ['o']],
  ['Find in file', ['⌘F']], ['Next / prev file', [']', '[']],
  ['Next / prev hunk', ['j', 'k']], ['Next / prev comment', ['n', 'p']],
  ['Next / prev line', ['↓', '↑']],
  ['Comment on line', ['c']], ['Toggle viewed', ['v']],
  ['Open in VS Code', ['.']], ['Unified / split', ['u']],
  ['Resolve focused thread', ['r']], ['Publish', ['⌘↩']],
  ['This keymap', ['?']], ['Close overlay / composer', ['Esc']],
];

export function Keymap() {
  const setOverlay = useStore(s => s.setOverlay);
  return (
    <Overlay onClose={() => setOverlay(null)}>
      <div data-testid="keymap">
        <div className="sheet-hd">Keyboard</div>
        <div className="keys">
          {ROWS.map(([label, keys]) => (
            <div key={label}><span>{label}</span><span>{keys.map(k => <kbd key={k}>{k}</kbd>)}</span></div>
          ))}
        </div>
      </div>
    </Overlay>
  );
}
