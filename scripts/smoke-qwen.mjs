/**
 * 统一厂商冒烟测试：验证三个固定模型在你的 DashScope 账号下可用。
 * 用法：node scripts/smoke-qwen.mjs sk-你的Key
 * 每模型一次极小调用（max_tokens 32），总消耗可忽略。
 */
import https from 'node:https';

const key = process.argv[2] ?? '';
if (!key.startsWith('sk-')) {
  console.error('用法：node scripts/smoke-qwen.mjs sk-你的DashScopeKey');
  process.exit(1);
}

const CASES = [
  { name: '对话 qwen-plus-character', model: 'qwen-plus-character', prompt: '用JSON回复：{"ok":true,"say":"一句话问好"}' },
  { name: '生活 qwen-plus', model: 'qwen-plus', prompt: '用JSON回复：{"ok":true,"plan":"一句话日程"}' },
  { name: '摘要 qwen-flash', model: 'qwen-flash', prompt: '用JSON回复：{"ok":true,"digest":"一句话摘要"}' },
];

function call(model, prompt) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 64,
      temperature: 0.1,
    });
    const req = https.request(
      {
        hostname: 'dashscope.aliyuncs.com',
        path: '/compatible-mode/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(raw);
            const content = j.choices?.[0]?.message?.content ?? '';
            resolve({ status: res.statusCode, ok: res.statusCode === 200 && Boolean(content), content: content.slice(0, 80) });
          } catch {
            resolve({ status: res.statusCode, ok: false, content: raw.slice(0, 120) });
          }
        });
      },
    );
    req.on('error', (e) => resolve({ status: 0, ok: false, content: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, ok: false, content: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

let failed = 0;
for (const c of CASES) {
  const r = await call(c.model, c.prompt);
  if (r.ok) console.log(`OK  ${c.name} → ${r.content}`);
  else { failed++; console.log(`FAIL ${c.name} → HTTP ${r.status}: ${r.content}`); }
}
console.log(failed === 0 ? '\n三个模型全部可用，统一厂商改造完成。' : `\n${failed} 个模型不可用，请检查账号/模型开通状态。`);
process.exit(failed ? 1 : 0);
