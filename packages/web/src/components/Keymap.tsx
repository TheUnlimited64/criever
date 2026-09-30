import { useStore } from '../store';
import { usePr } from '../hooks';
import { Overlay } from './Overlay';
import { shortcutLabel } from '../keys';

const ROWS: [string, string[]][] = [
  ['Jump to file', [shortcutLabel('K')]], ['Search repo', [shortcutLabel('F', true)]], ['PR overview', ['o']],
  ['Find in file', [shortcutLabel('F')]], ['Next / prev file', [']', '[']],
  ['Next / prev hunk', ['j', 'k']], ['Next / prev comment', ['n', 'p']],
  ['Next / prev line', ['↓', '↑']],
  ['Comment on line', ['c']], ['Toggle viewed', ['v']],
  ['Open in VS Code', ['.']], ['Unified / split', ['u']],
  ['Resolve focused thread', ['r']], ['Publish', [shortcutLabel('Enter')]],
  ['This keymap', ['?']], ['Close overlay / composer', ['Esc']],
];

export function Keymap() {
  const setOverlay = useStore(s => s.setOverlay);
  const local = usePr().data?.kind === 'local';
  return (
    <Overlay onClose={() => setOverlay(null)} label="Keyboard shortcuts">
      <div data-testid="keymap">
        <div className="sheet-hd">Keyboard</div>
        <div className="keys">
          {ROWS.map(([label, keys]) => (
            <div key={label}><span>{label === 'Publish' && local ? 'Save local review' : label === 'PR overview' ? 'Review overview' : label}</span><span>{keys.map(k => <kbd key={k}>{k}</kbd>)}</span></div>
          ))}
        </div>
      </div>
    </Overlay>
  );
}
