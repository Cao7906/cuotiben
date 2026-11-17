/* Vercel Serverless Function：/api/ai
 * 与本地 server.js 完全同款的请求清洗 + 双模型路由代理，解决浏览器直连智谱的跨域问题。
 * 请求体结构与前端 ai.js 一致；密钥只从环境变量读取，不写进前端或公开仓库。
 *
 * 需要的环境变量（Vercel 项目 Settings → Environment Variables）：
 *   AI_API_KEY     必填，智谱 API Key
 *   AI_BASE_URL    可选，默认 https://open.bigmodel.cn/api/paas/v4
 *   AI_VISION_MODEL 可选，默认 glm-4v-flash
 *   AI_TEXT_MODEL   可选，默认 glm-4-flash
 */
'use strict';

const LEGACY_IMAGE_KEYS = ['url', 'base64', 'image', 'data'];

function readKey() {
  const raw = String(process.env.AI_API_KEY || process.env.ZHIPU_API_KEY || '').trim();
  if (!raw || /[^\x20-\x7e]/.test(raw) || /在这里|your[-_ ]?api|xxxx|placeholder/i.test(raw)) return '';
  return raw;
}

function config() {
  const baseUrl = String(process.env.AI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/+$/, '');
  const isZhipu = /bigmodel\.cn/.test(baseUrl);
  return {
    baseUrl,
    isZhipu,
    apiKey: readKey(),
    vision: String(process.env.AI_VISION_MODEL || (isZhipu ? 'glm-4v-flash' : 'qwen-vl-max-latest')),
    text: String(process.env.AI_TEXT_MODEL || (isZhipu ? 'glm-4-flash' : 'qwen-plus'))
  };
}

/* ---------- 请求体规范化：智谱 v4 对 content[].type 校验严格 ---------- */
function normalizeImageUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const v = raw.trim();
  if (/^data:image\//i.test(v) || /^https?:\/\//i.test(v)) return v;
  if (/^[A-Za-z0-9+/=\r\n ]+$/.test(v) && v.length > 64) {
    return 'data:image/jpeg;base64,' + v.replace(/\s/g, '');
  }
  return '';
}

function cleanPart(part) {
  if (!part || typeof part !== 'object') return null;
  let type = part.type;
  if (part.image_url && typeof part.image_url === 'object') type = 'image_url';
  else if (type === undefined && typeof part.text === 'string') type = 'text';

  if (type === 'text') {
    return typeof part.text === 'string' ? { type: 'text', text: part.text } : null;
  }
  if (type === 'image_url') {
    let raw = part.image_url && typeof part.image_url === 'object' ? part.image_url.url : part.image_url;
    if (!raw) {
      for (let i = 0; i < LEGACY_IMAGE_KEYS.length; i += 1) {
        if (part[LEGACY_IMAGE_KEYS[i]]) { raw = part[LEGACY_IMAGE_KEYS[i]]; break; }
      }
    }
    const url = normalizeImageUrl(raw);
    return url ? { type: 'image_url', image_url: { url } } : null;
  }
  return null; // 丢弃非法 type，避免上游 1210
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return { messages: [], hasImage: false };
  let hasImage = false;
  const cleaned = messages.map((m) => {
    if (!m || typeof m !== 'object') return null;
    const role = m.role || 'user';
    if (typeof m.content === 'string' || m.content == null) return { role, content: String(m.content || '') };
    if (!Array.isArray(m.content)) return { role, content: '' };
    const parts = m.content.map(cleanPart).filter(Boolean);
    if (parts.some((p) => p.type === 'image_url')) hasImage = true;
    return { role, content: parts };
  }).filter(Boolean);

  // 纯文本请求：摊平成字符串，文本模型最稳妥
  if (!hasImage) {
    cleaned.forEach((m) => {
      if (Array.isArray(m.content)) m.content = m.content.map((p) => p.text || '').join('\n');
    });
  }
  return { messages: cleaned, hasImage };
}

function visionModel(cfg) {
  const m = cfg.vision || 'glm-4v-flash';
  if (cfg.isZhipu && !/v-|vision|vl|image/i.test(m)) return 'glm-4v-flash';
  return m;
}

/* Vercel 已自动解析 JSON body；这里兼容字符串，避免不同运行时差异 */
function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch (e) { return null; }
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: '请使用 POST 调用。' });
  }

  const cfg = config();
  if (!cfg.apiKey) {
    return res.status(400).json({
      error: 'NO_API_KEY',
      message: '服务端尚未配置 apiKey：请在 Vercel 项目 Settings → Environment Variables 添加 AI_API_KEY，然后重新部署。'
    });
  }

  const payload = parseBody(req);
  if (!payload) return res.status(400).json({ error: 'BAD_BODY', message: 'JSON 格式错误。' });

  const clean = sanitizeMessages(payload.messages);
  if (!clean.messages.length) {
    return res.status(400).json({ error: 'BAD_MESSAGES', message: '请求体缺少有效的 messages 内容。' });
  }

  // 只要含图片，无论前端传没传 task，都强制视觉模型，避免 1210。
  const task = (clean.hasImage || payload.task === 'vision') ? 'vision' : 'text';
  const model = task === 'vision' ? visionModel(cfg) : cfg.text;
  const requested = Number(payload.max_tokens) || (task === 'vision' ? 1024 : 2048);
  const maxTokens = task === 'vision' ? Math.min(1024, Math.max(1, requested)) : Math.max(1, requested);
  const body = JSON.stringify({
    model,
    messages: clean.messages,
    temperature: payload.temperature ?? 0.25,
    max_tokens: maxTokens,
    stream: false
  });
  const trace = { 'X-AI-Model': model, 'X-AI-Task': task, 'X-AI-Has-Image': String(clean.hasImage) };
  Object.keys(trace).forEach((k) => res.setHeader(k, trace[k]));

  // Vercel Hobby 函数有执行时长上限；给上游留足时间但仍设硬超时兜底。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const upstream = await fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body,
      signal: controller.signal
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: 'UPSTREAM_ERROR',
        message: text.slice(0, 600),
        model, task
      });
    }
    // 原样透传智谱的 JSON 响应，前端按既有逻辑解析
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(text);
  } catch (e) {
    const msg = e.name === 'AbortError' ? '上游接口超时（55 秒）' : e.message;
    return res.status(502).json({ error: 'NETWORK_ERROR', message: msg });
  } finally {
    clearTimeout(timer);
  }
};
