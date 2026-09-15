import https from 'node:https';

const key = process.argv[2] ?? '';
const model = process.argv[3] ?? 'qwen-plus-character';
if (!key.startsWith('sk-')) {
  console.error('Usage: node scripts/measure-qwen-ttft.mjs <dashscope-key> [model]');
  process.exit(1);
}

const started = performance.now();
const body = JSON.stringify({
  model,
  messages: [{ role: 'user', content: '请只回复：你好。' }],
  max_tokens: 16,
  temperature: 0.1,
  stream: true,
});

const result = await new Promise((resolve) => {
  let raw = '';
  let firstContentAt = null;
  let status = 0;
  const req = https.request({
    hostname: 'dashscope.aliyuncs.com',
    path: '/compatible-mode/v1/chat/completions',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      Accept: 'text/event-stream',
    },
    timeout: 30000,
  }, (res) => {
    status = res.statusCode ?? 0;
    let buffer = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      raw += chunk;
      buffer += chunk;
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const content = JSON.parse(payload).choices?.[0]?.delta?.content;
            if (content && firstContentAt === null) firstContentAt = performance.now();
          } catch {
            // Ignore incomplete or non-JSON SSE frames.
          }
        }
      }
    });
    res.on('end', () => resolve({ status, firstContentAt, totalAt: performance.now(), raw }));
  });
  req.on('error', (error) => resolve({ status: 0, firstContentAt, totalAt: performance.now(), raw: error.message }));
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.write(body);
  req.end();
});

const ttft = result.firstContentAt === null ? null : result.firstContentAt - started;
console.log(JSON.stringify({
  model,
  status: result.status,
  ttftMs: ttft === null ? null : Math.round(ttft),
  totalMs: Math.round(result.totalAt - started),
  ok: result.status === 200 && ttft !== null,
  responsePreview: result.raw.slice(0, 180),
}, null, 2));
process.exit(result.status === 200 && ttft !== null ? 0 : 1);
