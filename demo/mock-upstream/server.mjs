// Mock OpenAI-compatible upstream for the Bifrost Meter demo.
// It never calls a real model: every reply is a fixed text labelled [mock]
// with a token `usage` block, so Bifrost can count tokens and cost.
import { createServer } from 'node:http';

const port = Number(process.env.MOCK_PORT ?? 8787);
const replyText = process.env.MOCK_REPLY ?? '[mock] This reply comes from the Bifrost Meter mock upstream, not a real model.';
const promptTokens = Number(process.env.MOCK_PROMPT_TOKENS ?? 120);
const completionTokens = Number(process.env.MOCK_COMPLETION_TOKENS ?? 80);
const models = (process.env.MOCK_MODELS ?? 'gpt-4o-mini').split(',').map((m) => m.trim()).filter(Boolean);

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 1_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0].replace(/^\/v1/, '');
  if (req.method === 'GET' && path === '/health') return send(res, 200, { status: 'ok', mock: true });
  if (req.method === 'GET' && path === '/models') {
    return send(res, 200, { object: 'list', data: models.map((id) => ({ id, object: 'model', owned_by: 'mock' })) });
  }
  if (req.method === 'POST' && path === '/chat/completions') {
    const body = await readJson(req);
    const model = typeof body.model === 'string' ? body.model : models[0];
    return send(res, 200, {
      id: `chatcmpl-mock-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: replyText }, finish_reason: 'stop' }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
    });
  }
  return send(res, 404, { error: { message: `[mock] no route for ${req.method} ${path}` } });
});

server.listen(port, '0.0.0.0', () => console.log(`[mock] upstream listening on :${port}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
