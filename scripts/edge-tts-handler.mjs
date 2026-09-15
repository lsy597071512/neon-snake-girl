/**
 * @deprecated Edge TTS 已下线，项目改用百炼 Qwen-Audio-TTS（qwen-audio-3.0-tts-flash）。
 * 本文件保留仅作历史参考，Vite 不再挂载 /api/tts。
 */
export async function synthesizeToBuffer() {
  throw new Error('Edge TTS 已移除，请使用游戏内 Qwen-Audio-TTS');
}

export function attachEdgeTtsMiddleware(middlewares) {
  middlewares.use('/api/tts', (_req, res) => {
    res.statusCode = 410;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'Edge TTS 已下线。请配置 Qwen API Key，使用 qwen-audio-3.0-tts-flash。',
      }),
    );
  });
}
