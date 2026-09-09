// Hand-curated subset of the shortcodes that actually show up in code review comments,
// not the full CLDR/Unicode emoji shortcode list. node-emoji@2.2.0 was measured (its emojilib +
// skin-tone + @sindresorhus/is deps) at +46 kB gzipped / +225 kB raw for this app's bundle — a
// disproportionate cost for a lookup table. Swap in a full package if a real gap is hit.
const EMOJI: Record<string, string> = {
  thumbsup: '👍', '+1': '👍',
  thumbsdown: '👎', '-1': '👎',
  tada: '🎉', rocket: '🚀', eyes: '👀', fire: '🔥', warning: '⚠️',
  white_check_mark: '✅', x: '❌', bug: '🐛', sparkles: '✨', '100': '💯',
  heart: '❤️', clap: '👏', pray: '🙏', ok_hand: '👌', thinking: '🤔',
  bulb: '💡', zap: '⚡', memo: '📝', construction: '🚧', art: '🎨',
  recycle: '♻️', hammer: '🔨',
};

const SHORTCODE_RE = /:([a-z0-9_+-]+):/gi;
const FENCE_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
const INLINE_CODE_RE = /(`[^`\n]*`)/g;

function replaceOutsideInlineCode(text: string): string {
  return text.split(INLINE_CODE_RE).map((seg, i) => (i % 2 === 1 ? seg : seg.replace(SHORTCODE_RE, (m, name) => EMOJI[name.toLowerCase()] ?? m))).join('');
}

/** Converts Bitbucket-style :shortcode: emoji to the real character, leaving fenced code blocks and
 * inline code spans untouched so a CSS `:hover:`-like token or a colon-delimited literal survives. */
export function emojify(text: string): string {
  return text.split(FENCE_RE).map((part, i) => (i % 2 === 1 ? part : replaceOutsideInlineCode(part))).join('');
}
