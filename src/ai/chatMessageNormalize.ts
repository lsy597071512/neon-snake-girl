/**
 * Ollama / GGUF 聊天模板常强制：system 后必须严格 user/assistant 交替。
 * 营地对话历史常以角色主动发言开头，或连续两轮同角色 → 直接 400
 * “Unable to generate parser… raise_exception… must alternate”。
 */

import type { ChatMessage } from './llmClient';

export function normalizeChatMessagesForStrictTemplate(
  messages: ChatMessage[],
): ChatMessage[] {
  const systemChunks: string[] = [];
  const turns: ChatMessage[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      const t = m.content?.trim();
      if (t) systemChunks.push(t);
      continue;
    }
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = (m.content ?? '').trim();
    if (!content) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n${content}`;
    } else {
      turns.push({ role, content });
    }
  }

  // 角色先开口：不要并入 system（会改写静态前缀 → llama.cpp KV/LCP 整段失效，每轮多 5s+ prefill）。
  // 插入一条极短 user 占位，满足「system 后须以 user 起」的模板约束。
  if (turns.length > 0 && turns[0]!.role === 'assistant') {
    turns.unshift({
      role: 'user',
      content: '（指挥官在场，听你先说。）',
    });
  }

  const out: ChatMessage[] = [];
  if (systemChunks.length) {
    out.push({ role: 'system', content: systemChunks.join('\n\n') });
  }
  out.push(...turns);

  if (!out.some((m) => m.role === 'user')) {
    out.push({ role: 'user', content: '……' });
  }

  // 生成轮必须以 user 结尾（调用方通常已保证；合并后再次校正）
  if (out[out.length - 1]?.role === 'assistant') {
    out.push({ role: 'user', content: '（请继续）' });
  }

  return out;
}
