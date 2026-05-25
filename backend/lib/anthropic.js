const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MODEL_FALLBACKS = [
  process.env.ANTHROPIC_MODEL,
  DEFAULT_MODEL,
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
].filter(Boolean);

const MODEL = MODEL_FALLBACKS[0] || DEFAULT_MODEL;

function resolveApiKey(clientKey) {
  const key = String(clientKey || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) {
    throw new Error(
      'No Anthropic API key. In the app, click the "AI Key" chip in the header and paste your sk-ant-... key.'
    );
  }
  return key;
}

function formatAnthropicError(status, errBody) {
  const raw = errBody?.error?.message || errBody?.message || '';
  if (
    /claude-sonnet-4-20250514|claude-opus-4-20250514|deprecated|retired|not found/i.test(raw) ||
    (status === 404 && /model/i.test(raw))
  ) {
    return `AI model unavailable. Hard-refresh the app (Ctrl+Shift+R). Expected model: ${DEFAULT_MODEL}.`;
  }
  if (/invalid.?api.?key|authentication|401/i.test(raw) || status === 401) {
    return 'Invalid Anthropic API key. Open "AI Key" in the header and paste a new key from console.anthropic.com.';
  }
  if (/credit|billing|balance|402|403/i.test(raw) || status === 402) {
    return 'Anthropic billing issue — add credits at console.anthropic.com.';
  }
  return raw || `Anthropic API error (${status})`;
}

async function callAnthropicOnce(model, { apiKey, system, userContent, maxTokens }) {
  const key = resolveApiKey(apiKey);

  const messages = [{ role: 'user', content: userContent }];
  const body = { model, max_tokens: maxTokens, messages };
  if (system) body.system = system;

  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    let errBody = null;
    try {
      errBody = await resp.json();
    } catch {
      /* ignore */
    }
    const err = new Error(formatAnthropicError(resp.status, errBody));
    err.status = resp.status;
    err.isModelError = /model/i.test(err.message);
    throw err;
  }

  const data = await resp.json();
  return (data.content || []).map((c) => c.text || '').join('').trim();
}

async function callAnthropic(opts = {}) {
  const maxTokens = opts.maxTokens || 1024;
  const models = [...new Set(MODEL_FALLBACKS)];
  let lastErr = null;
  for (const model of models) {
    try {
      return await callAnthropicOnce(model, opts);
    } catch (err) {
      lastErr = err;
      if (!err.isModelError && err.status !== 404) throw err;
    }
  }
  throw lastErr || new Error('All AI models failed');
}

function parseJsonFromModel(text) {
  const cleaned = text.replace(/```json\n?|```/g, '').trim();
  return JSON.parse(cleaned);
}

module.exports = { callAnthropic, parseJsonFromModel, MODEL, DEFAULT_MODEL };
