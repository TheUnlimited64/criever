import { Fragment, type ReactNode, useMemo } from 'react';
import type { DiffLine, FileDiff, Side } from '@criever/shared';
import { highlightLine } from './highlight';

export interface RowExtra { afterLine: { side: Side; line: number }; node: ReactNode; key: string }
interface Common { path: string; extras: RowExtra[]; cursorLine: { side: Side; line: number } | null; onGutterClick: (side: Side, line: number, shiftKey: boolean) => void; selection?: { side: Side; from: number; to: number } | null }

const sideOf = (l: DiffLine): { side: Side; line: number } => l.kind === 'del' ? { side: 'old', line: l.oldNo! } : { side: 'new', line: l.newNo! };
const inSel = (c: Common, s: { side: Side; line: number }) => !!c.selection && c.selection.side === s.side && s.line >= c.selection.from && s.line <= c.selection.to;

function extrasAfter(extras: RowExtra[], s: { side: Side; line: number }, colSpan = 4) {
  return extras.filter(e => e.afterLine.side === s.side && e.afterLine.line === s.line).map(e => <tr key={e.key} className="thread"><td colSpan={colSpan}>{e.node}</td></tr>);
}

function Row({ l, c }: { l: DiffLine; c: Common }) {
  const s = sideOf(l);
  const cls = ['line', l.kind === 'context' ? '' : l.kind, c.cursorLine?.side === s.side && c.cursorLine.line === s.line ? 'cursor' : '', inSel(c, s) ? 'sel' : ''].join(' ');
  return (
    <tr className={cls} data-testid={`code/row/${s.side}/${s.line}`} data-side={s.side} data-line={s.line}>
      <td className="ln o">{l.oldNo ?? ''}</td><td className="ln">{l.newNo ?? ''}</td>
      <td className="g" data-testid={`code/row/${s.side}/${s.line}/gutter`} onClick={e => c.onGutterClick(s.side, s.line, e.shiftKey)}>{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</td>
      <td className="src" dangerouslySetInnerHTML={{ __html: highlightLine(l.text, c.path) || ' ' }} />
    </tr>
  );
}

export function DiffTable(p: Common & { file: FileDiff; split: boolean; onExpand: () => void }) {
  if (p.file.binary) return <div className="empty" data-testid="code/binary">Binary file</div>;
  return (
    <table className="diff" data-testid="code/diff" data-split={p.split}>
      <tbody>
        {p.file.hunks.map((h, i) => (
          <Fragment key={i}>
            <tr className="hunk" data-testid={`code/hunk/${i}`}><td colSpan={4}>@@ -{h.oldStart},{h.oldLen} +{h.newStart},{h.newLen} @@ {h.header} <button data-testid={`code/hunk/${i}/expand`} onClick={p.onExpand}>↕ expand</button></td></tr>
            {p.split ? <SplitRows lines={h.lines} c={p} /> : h.lines.map((l, j) => <Fragment key={j}><Row l={l} c={p} />{extrasAfter(p.extras, sideOf(l))}</Fragment>)}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/** Split view: pairs del/add runs side by side. Rendered as one table with 2×(ln, g, src) columns; extras span all. */
function SplitRows({ lines, c }: { lines: DiffLine[]; c: Common }) {
  const pairs = useMemo(() => {
    const out: { left: DiffLine | null; right: DiffLine | null }[] = [];
    for (let i = 0; i < lines.length;) {
      const l = lines[i]!;
      if (l.kind === 'context') { out.push({ left: l, right: l }); i++; continue; }
      const dels: DiffLine[] = [], adds: DiffLine[] = [];
      while (i < lines.length && lines[i]!.kind === 'del') dels.push(lines[i++]!);
      while (i < lines.length && lines[i]!.kind === 'add') adds.push(lines[i++]!);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push({ left: dels[k] ?? null, right: adds[k] ?? null });
    }
    return out;
  }, [lines]);
  const cell = (l: DiffLine | null, side: Side) => {
    if (!l) return <><td className="ln" /><td className="g" /><td className="src empty" /></>;
    const lineNo = (side === 'old' ? l.oldNo : l.newNo)!;
    return (
      <>
        <td className={`ln ${side === 'old' ? 'o' : ''}`}>{lineNo}</td>
        <td className={`g ${l.kind}`} data-testid={`code/row/${side}/${lineNo}/gutter`} onClick={e => c.onGutterClick(side, lineNo, e.shiftKey)}>{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</td>
        <td className={`src ${l.kind}`} dangerouslySetInnerHTML={{ __html: highlightLine(l.text, c.path) || ' ' }} />
      </>
    );
  };
  return <>{pairs.map((pr, i) => {
    const s = pr.right ? sideOf(pr.right) : pr.left ? sideOf(pr.left) : null;
    const cls = ['line', 'split', s && c.cursorLine?.side === s.side && c.cursorLine.line === s.line ? 'cursor' : '', s && inSel(c, s) ? 'sel' : ''].join(' ');
    return (
      <Fragment key={i}>
        <tr className={cls} data-testid={s ? `code/row/${s.side}/${s.line}` : undefined} data-side={s?.side} data-line={s?.line}>{cell(pr.left, 'old')}{cell(pr.right, 'new')}</tr>
        {pr.left && pr.left.kind === 'del' && extrasAfter(c.extras, sideOf(pr.left), 6)}
        {pr.right && extrasAfter(c.extras, sideOf(pr.right), 6)}
      </Fragment>
    );
  })}</>;
}

/** Plain file view (any commit). */
export function FileTable(p: Common & { content: string }) {
  const lines = useMemo(() => p.content.replace(/\n$/, '').split('\n'), [p.content]);
  return (
    <table className="diff" data-testid="code/file">
      <tbody>{lines.map((t, i) => {
        const line = i + 1; const s = { side: 'new' as Side, line };
        return (
          <Fragment key={i}>
            <tr className={`line ${p.cursorLine?.line === line ? 'cursor' : ''} ${inSel(p, s) ? 'sel' : ''}`} data-testid={`code/row/new/${line}`} data-side="new" data-line={line}>
              <td className="ln">{line}</td><td className="g" onClick={e => p.onGutterClick('new', line, e.shiftKey)} /><td className="src" dangerouslySetInnerHTML={{ __html: highlightLine(t, p.path) || ' ' }} />
            </tr>
            {extrasAfter(p.extras, s, 3)}
          </Fragment>
        );
      })}</tbody>
    </table>
  );
}
