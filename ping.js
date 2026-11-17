/* Vercel Serverless Function：/api/ping
 * 前端据此判断「服务端代理」是否就绪。逻辑与本地 server.js 的 /api/ping 一致。
 * 密钥只从环境变量读取，绝不写进前端或公开仓库。 */
'use strict';

function readKey() {
  const raw = String(process.env.AI_API_KEY || process.env.ZHIPU_API_KEY || '').trim();
  if (!raw || /[^\x20-\x7e]/.test(raw) || /在这里|your[-_ ]?api|xxxx|placeholder/i.test(raw)) return '';
  return raw;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = readKey();
  const baseUrl = String(process.env.AI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/+$/, '');
  const isZhipu = /bigmodel\.cn/.test(baseUrl);
  const vision = String(process.env.AI_VISION_MODEL || (isZhipu ? 'glm-4v-flash' : 'qwen-vl-max-latest'));
  const text = String(process.env.AI_TEXT_MODEL || (isZhipu ? 'glm-4-flash' : 'qwen-plus'));
  return res.status(200).json({
    ok: true,
    proxy: true,
    configured: !!key,
    provider: baseUrl,
    model: vision,
    models: { vision, text }
  });
};
