// Vapi API client: creates/updates one assistant per tenant.
// Docs: https://docs.vapi.ai — verify payload shapes if the API has evolved.
import { cfg } from './config.js';
import { buildSystemPrompt, buildFirstMessage } from './prompt.js';

const API = 'https://api.vapi.ai';

function toolDefs() {
  return [
    {
      type: 'function',
      function: {
        name: 'getCurrentDateTime',
        description: 'Returns the current date, weekday and time in the business timezone. Always use this before interpreting relative dates like "tomorrow".',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'checkAvailability',
        description: 'Fetches real free appointment slots from the agenda. Optionally filtered by date and day part.',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Requested date in YYYY-MM-DD format (optional)' },
            dayPart: { type: 'string', enum: ['morning', 'afternoon', 'evening'], description: 'Requested part of day (optional)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'bookAppointment',
        description: 'Definitively books an appointment in the agenda. Only use after the caller has explicitly confirmed the summary.',
        parameters: {
          type: 'object',
          required: ['name', 'date', 'time'],
          properties: {
            name: { type: 'string', description: 'Full name of the customer' },
            phone: { type: 'string', description: 'Customer phone number' },
            date: { type: 'string', description: 'Date in YYYY-MM-DD' },
            time: { type: 'string', description: 'Start time in HH:MM (24h)' },
            service: { type: 'string', description: 'Requested service or treatment' },
            notes: { type: 'string', description: 'Any extra notes' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'takeMessage',
        description: 'Records a callback request or message for the business.',
        parameters: {
          type: 'object',
          required: ['message'],
          properties: {
            name: { type: 'string' },
            phone: { type: 'string' },
            message: { type: 'string', description: 'The caller\'s message' },
          },
        },
      },
    },
  ];
}

export function assistantPayload(tenant) {
  return {
    name: `${tenant.name} — AI receptionist (tenant ${tenant.id})`,
    firstMessage: buildFirstMessage(tenant),
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.4,
      messages: [{ role: 'system', content: buildSystemPrompt(tenant) }],
      tools: toolDefs(),
    },
    transcriber: {
      provider: 'deepgram',
      model: 'nova-2',
      language: ['nl', 'fr', 'en', 'de'].includes(tenant.language) ? tenant.language : 'nl',
    },
    voice: {
      provider: '11labs',
      voiceId: tenant.voice_id || cfg.defaultVoiceId,
      model: 'eleven_multilingual_v2',
    },
    server: {
      url: `${cfg.baseUrl}/webhook/vapi`,
      secret: cfg.vapiWebhookSecret,
    },
    serverMessages: ['tool-calls', 'end-of-call-report'],
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 900,
    endCallMessage: 'Bedankt voor het bellen. Tot ziens!',
  };
}

async function vapiFetch(path, method, body) {
  if (!cfg.vapiApiKey) throw new Error('VAPI_API_KEY is not set in .env');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.vapiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Vapi ${method} ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Create the assistant for a tenant, or push updated config to the existing one. */
export async function provisionAssistant(tenant) {
  const payload = assistantPayload(tenant);
  if (tenant.vapi_assistant_id) {
    return vapiFetch(`/assistant/${tenant.vapi_assistant_id}`, 'PATCH', payload);
  }
  return vapiFetch('/assistant', 'POST', payload);
}
