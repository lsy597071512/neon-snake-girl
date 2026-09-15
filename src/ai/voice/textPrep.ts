/**
 * 贴近 cyber：只清洗舞台指示，尽量不改写标点。
 * 情感交给 LLM 台词本身 + 轻微 Edge 韵律，避免「机械感」二次加工。
 */
export function prepareSpeakText(raw: string): string {
  let t = (raw || '').trim();
  if (!t) return '';

  t = t
    .replace(/（[^）]*）/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/【[^】]*】/g, ' ')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (t.length > 220) t = `${t.slice(0, 218)}……`;
  return t;
}
