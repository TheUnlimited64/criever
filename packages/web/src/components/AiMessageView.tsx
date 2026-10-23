import type { AiMessage } from '@criever/shared';
import { renderMarkdown } from './markdown';

function safeAiMarkdown(source: string, interactive = true): string {
  const template = document.createElement('template');
  template.innerHTML = renderMarkdown(source);
  template.content.querySelectorAll('img').forEach(image => image.replaceWith(document.createTextNode(image.alt || 'Image omitted')));
  template.content.querySelectorAll('a').forEach(link => {
    if (!interactive) { link.replaceWith(...link.childNodes); return; }
    const href = link.getAttribute('href');
    try {
      if (!href || !['http:', 'https:'].includes(new URL(href, window.location.href).protocol)) link.removeAttribute('href');
      else { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    } catch { link.removeAttribute('href'); }
  });
  if (!interactive) template.content.querySelectorAll('input').forEach(input => input.replaceWith(document.createTextNode(input.checked ? '☑ ' : '☐ ')));
  return template.innerHTML;
}

export function AiMessageView({ message }: { message: AiMessage }) {
  return <div className={`ai-message ${message.role}`}><b>{message.role === 'user' ? 'You' : 'AI'}</b><div className="mdPreview" dangerouslySetInnerHTML={{ __html: safeAiMarkdown(message.content) }} /></div>;
}

// Result lists use button cards: remove interactive Markdown descendants there.
export function AiResultBody({ body, interactive = true }: { body: string; interactive?: boolean }) {
  return <div className="mdPreview ai-result-body" dangerouslySetInnerHTML={{ __html: safeAiMarkdown(body, interactive) }} />;
}
