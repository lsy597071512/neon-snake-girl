/**
 * 登录门禁界面（私测发行）：玩家只填「账号 + 自己的千问 API Key」两栏即可进入。
 * - 账号：开发者提前开通（白名单）
 * - API Key：玩家自备的阿里云百炼/DashScope Key（sk-…），保存到手机本地
 * 登录成功 + Key 校验通过 → resolve(true)。
 */
import { setStoredApiKey } from '../ai/llmClient';
import { fetchDashscope } from '../ai/dashscopeFailover';
import type { LoginResult } from '../platform/license';

export function showLoginGate(
  login: (code: string) => Promise<LoginResult>,
  selfUnbind: (code: string) => Promise<{ ok: boolean; message: string }>,
): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      overlay.remove();
      resolve(ok);
    };

    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '登录锈带纪元');
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 12px; padding: 24px; text-align: center; overflow-y: auto;
      background: radial-gradient(120% 90% at 50% 12%, #171a22 0%, #0a0b0f 62%, #06070a 100%);
      color: #e8e2d6; font-family: 'Rajdhani','Noto Sans SC',system-ui,sans-serif;`;

    const fieldStyle = `width:min(340px,86vw);padding:12px 14px;font-size:16px;
      color:#f0ead9;background:#11131a;border:1px solid #3a3d47;border-radius:10px;outline:none;`;
    const labelStyle = `width:min(340px,86vw);text-align:left;font-size:13px;color:#b9b2a2;margin:6px 0 -6px;`;

    overlay.innerHTML = `
      <div style="font-size:12px;letter-spacing:.5em;color:#8b8474;text-transform:uppercase;">Rust Belt Era</div>
      <h1 style="margin:0;font-size:28px;letter-spacing:.18em;color:#e8b96a;text-shadow:0 0 22px rgba(232,185,106,.25);">锈带纪元</h1>
      <p style="margin:0;font-size:13px;color:#b9b2a2;max-width:340px;line-height:1.7;">
        私人测试版 · 输入你的<b style="color:#e8b96a">兑换码</b>与<b style="color:#e8b96a">千问 API Key</b> 即可开始。<br />
        兑换码即你的账号（购买后自动发放）；Key 只存在你手机本地。
      </p>
      <div style="${labelStyle}">兑换码 / 爱发电订单号（购买后自动发货）</div>
      <input data-account type="text" autocomplete="off" spellcheck="false" maxlength="16" placeholder="RB-XXXX-XXXX 或 订单号"
        style="${fieldStyle};text-align:center;letter-spacing:.14em;text-transform:uppercase;" />
      <div style="${labelStyle}">千问 API Key（阿里云百炼 dashscope，sk- 开头）</div>
      <input data-apikey type="password" autocomplete="off" spellcheck="false" maxlength="80" placeholder="sk-…"
        style="${fieldStyle};letter-spacing:.06em;" />
      <button data-go type="button"
        style="width:min(340px,86vw);padding:13px 16px;font-size:17px;letter-spacing:.3em;cursor:pointer;margin-top:4px;
               color:#14100a;background:linear-gradient(180deg,#f0c877,#d9a24a);border:none;border-radius:10px;font-weight:700;">
        进 入 游 戏
      </button>
      <button data-selfunbind type="button" hidden
        style="width:min(340px,86vw);padding:10px 16px;font-size:14px;cursor:pointer;
               color:#ffd9a8;background:rgba(232,185,106,.08);border:1px solid rgba(232,185,106,.4);border-radius:10px;">
        强制解绑旧设备（30 天可自助一次）
      </button>
      <p data-msg style="margin:0;min-height:20px;font-size:13px;color:#e08a8a;max-width:360px;"></p>
      <p style="margin:4px 0 0;font-size:12px;color:#6f6a5e;line-height:1.7;">
        没有兑换码？联系开发者购买 · Key 获取：阿里云搜「百炼」→ API-KEY 管理 → 创建（有免费额度）
      </p>
      <button data-exit type="button" style="margin-top:2px;background:none;border:none;color:#57534a;font-size:12px;cursor:pointer;text-decoration:underline;">
        暂不登录，先退出
      </button>`;

    const accountInput = overlay.querySelector<HTMLInputElement>('[data-account]')!;
    const keyInput = overlay.querySelector<HTMLInputElement>('[data-apikey]')!;
    const btn = overlay.querySelector<HTMLButtonElement>('[data-go]')!;
    const unbindBtn = overlay.querySelector<HTMLButtonElement>('[data-selfunbind]')!;
    const msg = overlay.querySelector<HTMLElement>('[data-msg]')!;

    const submit = async () => {
      const code = accountInput.value.trim().toUpperCase();
      const key = keyInput.value.trim();
      if (!code) {
        msg.textContent = '请输入兑换码';
        return;
      }
      if (!key.startsWith('sk-') || key.length < 20) {
        msg.textContent = 'API Key 应为 sk- 开头的长字符串，请核对';
        return;
      }
      btn.disabled = true;
      unbindBtn.hidden = true;
      btn.textContent = '验证中…';
      msg.textContent = '';

      // ① 兑换码登录（网关）
      const r = await login(code);
      if (!r.ok) {
        btn.disabled = false;
        btn.textContent = '进 入 游 戏';
        msg.textContent = r.message;
        if (r.tooManyDevices) {
          unbindBtn.hidden = false;
        }
        return;
      }

      // ② 保存并实连校验千问 Key（一次 1 token 微调用，坏 Key 当场发现）
      btn.textContent = '校验 Key…';
      msg.style.color = '#b9b2a2';
      msg.textContent = '正在校验 API Key…';
      setStoredApiKey(key);
      const check = await checkQwenKey(key);
      if (!check.ok) {
        btn.disabled = false;
        btn.textContent = '进 入 游 戏';
        msg.style.color = '#e08a8a';
        msg.textContent = check.message;
        return;
      }

      btn.textContent = '登录成功';
      msg.style.color = '#9fd6a0';
      msg.textContent = '欢迎回到锈带，正在进入…';
      window.setTimeout(() => finish(true), 500);
    };

    const doSelfUnbind = async () => {
      const code = accountInput.value.trim().toUpperCase();
      if (!code) {
        msg.textContent = '请先输入兑换码';
        return;
      }
      unbindBtn.disabled = true;
      msg.style.color = '#b9b2a2';
      msg.textContent = '解绑中…';
      const r = await selfUnbind(code);
      unbindBtn.disabled = false;
      msg.style.color = r.ok ? '#9fd6a0' : '#e08a8a';
      msg.textContent = r.message;
      if (r.ok) {
        unbindBtn.hidden = true;
        void submit();
      }
    };

    btn.addEventListener('click', () => void submit());
    unbindBtn.addEventListener('click', () => void doSelfUnbind());
    for (const el of [accountInput, keyInput]) {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void submit();
      });
    }
    overlay.querySelector('[data-exit]')?.addEventListener('click', () => finish(false));

    document.body.appendChild(overlay);
    window.setTimeout(() => accountInput.focus(), 80);
  });
}

/** DashScope Key 实连校验（极小调用） */async function checkQwenKey(key: string): Promise<{ ok: boolean; message: string }> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetchDashscope(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen-flash',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
        signal: ctrl.signal,
      },
    );
    if (res.ok) return { ok: true, message: '' };
    const text = await res.text().catch(() => '');
    if (res.status === 401) return { ok: false, message: 'API Key 无效，请到阿里云百炼重新生成' };
    if (/[额度|余额|欠费|quota|billing]/i.test(text)) {
      return { ok: false, message: 'Key 有效但账户额度不足，请到阿里云百炼充值或领取免费额度' };
    }
    return { ok: true, message: '' }; // 其他错误（网络抖动等）不拦人，进游戏后再报
  } catch {
    return { ok: true, message: '' }; // 校验请求失败不拦人（可能只是网络问题）
  } finally {
    window.clearTimeout(timer);
  }
}
