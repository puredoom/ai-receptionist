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
        description: 'Geeft de huidige datum, weekdag en tijd in de tijdzone van het bedrijf. Gebruik dit altijd voordat je relatieve datums zoals "morgen" interpreteert.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'checkAvailability',
        description: 'Vraagt echte vrije afspraaktijden op uit de agenda. Optioneel gefilterd op datum en dagdeel.',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Gewenste datum in JJJJ-MM-DD formaat (optioneel)' },
            dayPart: { type: 'string', enum: ['morning', 'afternoon', 'evening'], description: 'Gewenst dagdeel (optioneel)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'bookAppointment',
        description: 'Boekt definitief een afspraak in de agenda. Alleen gebruiken nadat de beller de samenvatting expliciet heeft bevestigd.',
        parameters: {
          type: 'object',
          required: ['name', 'date', 'time'],
          properties: {
            name: { type: 'string', description: 'Volledige naam van de klant' },
            phone: { type: 'string', description: 'Telefoonnummer van de klant' },
            date: { type: 'string', description: 'Datum in JJJJ-MM-DD' },
            time: { type: 'string', description: 'Starttijd in UU:MM (24-uurs)' },
            service: { type: 'string', description: 'Gevraagde dienst of behandeling' },
            notes: { type: 'string', description: 'Eventuele extra notities' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'takeMessage',
        description: 'Noteert een terugbelverzoek of bericht voor het bedrijf.',
        parameters: {
          type: 'object',
          required: ['message'],
          properties: {
            name: { type: 'string' },
            phone: { type: 'string' },
            message: { type: 'string', description: 'De boodschap van de beller' },
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
      language: 'nl',
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
