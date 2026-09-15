/**
 * 清洗角色对白：本地 RP 模型常见自报名、把 desire_next/记念抄进 dialogue。
 */
import { CHARACTER_MAP } from '../data/characters';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameVariants(characterId: string): string[] {
  const full = CHARACTER_MAP[characterId]?.name?.trim() ?? '';
  if (!full) return [];
  const compact = full.replace(/\s+/g, '');
  const parts = full.split(/[·・•]/).map((p) => p.trim()).filter(Boolean);
  const short = parts[parts.length - 1] ?? '';
  const out = new Set<string>();
  for (const n of [full, compact, short, parts.join(''), parts.join('·'), parts.join(' · ')]) {
    if (n && n.length >= 1) out.add(n);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** 去掉「白楯 · 芹奈：」「芹奈：」等自报名开场 */
export function stripSelfNamePrefix(dialogue: string, characterId: string): string {
  let d = (dialogue || '').trim();
  if (!d) return d;
  for (const n of nameVariants(characterId)) {
    const re = new RegExp(`^${escapeRegExp(n)}\\s*[:：]\\s*`);
    d = d.replace(re, '');
    // 「白楯 · 芹奈稍后想去…」无冒号
    const reHang = new RegExp(`^${escapeRegExp(n)}(?=稍后|之后|想去|打算|准备)`);
    d = d.replace(reHang, '');
  }
  return d.trim();
}

/**
 * 整句像系统记念 / desire_next 泄漏（不是嘴里说的话）→ 视为无效对白。
 */
export function looksLikeDesireOrMemoLeak(dialogue: string): boolean {
  const d = (dialogue || '').trim();
  if (!d) return false;
  if (/^room_[\w]+\s*[:：]/.test(d)) return true;
  if (/（已记念/.test(d)) return true;
  if (/^(稍后|之后)想去.+[：:]/.test(d)) return true;
  if (/^挂念[：:]/.test(d)) return true;
  // 「稍后想去泳池：想泡一会」整句
  if (/想去[\u4e00-\u9fff]{1,8}[：:].{0,24}$/.test(d) && d.length <= 36 && !/[？?]/.test(d)) {
    return true;
  }
  return false;
}

/** 流式/解析泄漏：```json 残片、半截 JSON 键等 */
export function stripJsonStreamArtifacts(dialogue: string): string {
  let d = (dialogue || '').trim();
  if (!d) return d;
  if (/^```\s*json/i.test(d) || /^```\s*$/i.test(d)) return '';
  d = d.replace(/```json\s*/gi, '');
  d = d.replace(/```\s*/g, '');
  d = d.replace(/^\s*\{\s*"dialogue"\s*:\s*"?/i, '');
  d = d.replace(/^"dialogue"\s*:\s*"?/i, '');
  d = d.replace(/"\s*,\s*"emotion"[\s\S]*$/i, '');
  return d.trim();
}

export function sanitizeCharacterDialogue(dialogue: string, characterId: string): string {
  let d = stripJsonStreamArtifacts(stripSelfNamePrefix(dialogue, characterId));
  if (looksLikeDesireOrMemoLeak(d)) {
    // 不编台词：记念泄漏时清空，让上层展示空/省略，而不是程序写的「嗯」
    return '';
  }
  // 去掉尾部误粘的记念括号
  d = d.replace(/\s*（已记念[^）]*）\s*$/u, '').trim();
  return d;
}
