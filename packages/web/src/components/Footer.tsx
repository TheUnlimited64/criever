import { usePr } from '../hooks';
const K = ({ k, label }: { k: string[]; label: string }) => <span>{k.map(x => <kbd key={x}>{x}</kbd>)} {label}</span>;
export function Footer() {
  const pr = usePr().data;
  return (
    <footer className="ftr" data-testid="footer">
      <K k={['⌘K']} label="files" /><K k={['⌘⇧F']} label="search" /><K k={['j', 'k']} label="hunks" /><K k={['n', 'p']} label="comments" />
      <K k={['c']} label="comment" /><K k={['v']} label="viewed" /><K k={['.']} label="VS Code" /><K k={['?']} label="all keys" />
      <span className="right" data-testid="footer/head">source {pr?.sourceHead.slice(0, 7)}</span>
    </footer>
  );
}
