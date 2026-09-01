import { SIGNALS } from './governance-signals.js';

const SIGNAL_ALIASES = {
  growth: 'scale',
  lendinggrowth: 'scale',
  borrowyield: 'price',
  revenue: 'capture',
  risk: 'security',
  generalpurpose: 'general',
  other: 'general',
};

function topicContent(topic) {
  return String(topic.proposal_content || topic.proposal_excerpt || '').trim();
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function requestHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function parseJsonContent(content) {
  const text = String(content || '').trim();
  const withoutFence = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Model did not return JSON.');
    return JSON.parse(withoutFence.slice(start, end + 1));
  }
}

export function normalizeSynthesis(value) {
  const summary = typeof value?.summary === 'string' ? value.summary.trim() : '';
  const rawSignal = String(value?.signal || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const signal = SIGNAL_ALIASES[rawSignal] || rawSignal;
  const signalReason = typeof value?.signal_reason === 'string' ? value.signal_reason.trim() : '';

  if (!summary) throw new Error('Model returned an empty summary.');
  if (!SIGNALS[signal]) throw new Error(`Model returned an unknown signal: ${signal || 'empty'}.`);

  return {
    proposal_summary: summary,
    signal,
    signal_reason: signalReason,
    ai_synthesized_at: new Date().toISOString(),
  };
}

export async function getLoadedModel(baseUrl, requestOptions = {}) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
    headers: requestHeaders(requestOptions.apiKey),
    signal: requestOptions.signal,
  });
  if (!response.ok) throw new Error(`LM Studio model list failed (${response.status}).`);
  const payload = await response.json();
  const model = payload.data?.[0]?.id;
  if (!model) throw new Error('LM Studio has no loaded model. Load a model and try again.');
  return model;
}

export function createSynthesisPrompt(topic) {
  const content = topicContent(topic).slice(0, 12000);
  return `Analyze this DeFi governance post. Identify the primary intended change, not merely the topic being discussed.

Return ONLY valid JSON with this exact shape:
{"summary":"2-3 concise sentences for an investor audience","signal":"scale|price|capture|security|general","signal_reason":"one short sentence explaining the classification"}

Signal definitions:
- scale: changes active loan growth, demand, liquidity, utilization, or lending capacity
- price: changes gross borrow yield, interest rates, fees, spreads, or pricing
- capture: changes take rate, revenue share, reserve factor, or treasury economics
- security: changes risk parameters, oracles, liquidation, audits, caps, or safeguards
- general: governance process, grants, strategy, operations, or anything else

Do not invent facts, outcomes, or votes. If a post touches multiple signals, choose the one most directly affected by the proposed change.

Protocol: ${topic.protocol || 'Unknown'}
Category: ${topic.category || 'Unknown'}
Title: ${topic.title || 'Untitled'}
Original post:
${content || 'No post content is available.'}`;
}

export async function synthesizeTopic(topic, options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const model = options.model || await getLoadedModel(baseUrl, options);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: requestHeaders(options.apiKey),
    signal: options.signal,
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 240,
      messages: [
        {
          role: 'system',
          content: 'You classify DeFi governance proposals precisely and follow the requested JSON format.',
        },
        { role: 'user', content: createSynthesisPrompt(topic) },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`LM Studio synthesis failed (${response.status}).`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  return normalizeSynthesis(parseJsonContent(content));
}
