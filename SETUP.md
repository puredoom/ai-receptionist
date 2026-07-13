# Setup — Dutch AI Phone Receptionist

What this is: a multi-tenant server that powers an AI receptionist. Each business customer
("tenant") gets their own phone number, their own Dutch AI assistant, and their own Google
Calendar. During a call the voice platform (Vapi) streams audio, and calls THIS server to
check availability and book appointments.

```
Caller ──► Phone number ──► Vapi (speech-to-text, Dutch AI voice, conversation)
                              │  tool calls: "check agenda", "book", "take message"
                              ▼
                        This server (Node.js)
                              │
                              ▼
                    Google Calendar of the business
```

## What I (Claude) already built — no action needed

- `src/server.js` — Express server: admin API, dashboard, Google OAuth, Vapi webhook
- `src/webhook.js` — the live-call brain (availability, booking, messages)
- `src/slots.js` — timezone/DST-correct availability engine (tested)
- `src/prompt.js` — the Dutch conversation prompt (incl. required AI disclosure)
- `src/vapi.js` — creates one Vapi assistant per business, wired to this server
- `public/index.html` — admin dashboard
- `test/simulate.mjs` — full simulation test suite (`npm test`)

## What only YOU can do (accounts & keys) — ~1 hour

### 1. Run it locally
```
cd ai-receptionist
npm install
copy .env.example .env     # then edit .env
npm test                   # should print all "ok"
npm start                  # dashboard on http://localhost:3000
```
Set `ADMIN_KEY` in `.env` to any long random string; log into the dashboard with it.

### 2. Vapi account (the voice platform) — vapi.ai
1. Sign up, copy your **API key** into `VAPI_API_KEY` in `.env`.
2. Set `VAPI_WEBHOOK_SECRET` to any long random string.
3. Buy a phone number in the Vapi dashboard (Dutch numbers via their Twilio import, or
   start with the free US number for testing — you can call it from NL).
4. In our dashboard: add a business → click **"Maak AI aan"** → assign the returned
   assistant ID to your phone number in Vapi (Phone Numbers → select number → Assistant).

Cost: roughly $0.10–0.20 per call-minute (covers phone, speech recognition, AI, voice).

### 3. Google Cloud OAuth (for calendars) — console.cloud.google.com
1. Create a project → "APIs & Services" → enable **Google Calendar API**.
2. "OAuth consent screen": External, add yourself as test user.
3. "Credentials" → Create **OAuth client ID** → Web application →
   authorized redirect URI: `https://YOUR-SERVER/oauth/google/callback`
   (plus `http://localhost:3000/oauth/google/callback` for local testing).
4. Copy client ID + secret into `.env`.
5. In our dashboard, each business clicks **"Koppel Google Agenda"** once.

### 4. Host the server (needed for real calls — Vapi must reach it)
- Easiest: [Railway](https://railway.app) or [Render](https://render.com) — connect a Git
  repo or upload, set the `.env` variables in their dashboard, done. ~$5/month.
- For a quick test from your own PC: `ngrok http 3000` and put the ngrok URL in `BASE_URL`,
  then re-provision the assistant (button in dashboard) so Vapi gets the new URL.
- After changing `BASE_URL`, always click **"Update AI"** per tenant — the webhook URL is
  baked into each assistant.

### 5. First real test call
1. Tenant added, agenda connected, assistant provisioned, number assigned.
2. Call the number. You should hear: *"Goedendag, u spreekt met de digitale assistent
   van …"*
3. Ask: "Ik wil graag een afspraak morgenochtend." — it should offer real free slots and
   book one. Check the Google Calendar and the dashboard's Afspraken tab.

## Voice quality ("it should sound legit")
The default voice is an ElevenLabs multilingual voice. For the most natural Dutch:
browse elevenlabs.io/voice-library, filter Dutch, pick a voice you like, and paste its
voice ID into the tenant's `voice_id` (dashboard → edit, or API) — then "Update AI".

## Legal notes (NL/EU)
- The prompt already discloses it's a digital assistant (EU AI Act transparency duty) —
  do not remove that.
- Don't record calls without informing callers; we only store transcripts/summaries that
  Vapi provides. Mention this in your customers' privacy policy.
- You're processing callers' personal data (names, phone numbers) on behalf of your
  business customers — when you start selling this, you'll need a simple processing
  agreement (verwerkersovereenkomst) with each customer. Standard NL templates exist.

## Business model (when you sell this to businesses)
- Typical pricing for AI receptionists in NL: €49–199/month per business + optional
  per-minute overage. Your cost is ~€0.10–0.18/min — margin is healthy at ~100+
  minutes/month.
- Target niches where missed calls = lost revenue: kappers, tandartsen,
  fysiotherapeuten, garages, schoonheidssalons.
