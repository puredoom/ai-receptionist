# Commercial deployment — click-by-click

Goal: server running 24/7 in the cloud, real Dutch phone number, real calendars.
Total cost to start: ~€25/month (hosting €5, number ~€5, ~€15 call credit).

Your production secrets (already generated — paste these, don't reuse the local dev ones):

```
ADMIN_KEY=96317798542e528ac24bf4f077109a8bde90692f531fa4c5
VAPI_WEBHOOK_SECRET=c5169577a9896572e9745d4b5a5fcbcbad3ae99ab447f94f
```

## Step 1 — Put the code on GitHub (~10 min)

The local git repo is already initialized and committed. You only need to push it:

1. Go to github.com → sign in (or create account) → New repository →
   name `ai-receptionist`, **Private** → Create.
2. GitHub shows commands under "…or push an existing repository". In a terminal:
   ```
   cd C:\Users\David\Desktop\Busines\ai-receptionist
   git remote add origin https://github.com/YOUR-USERNAME/ai-receptionist.git
   git push -u origin main
   ```
   (`.env` and the database are git-ignored — secrets never leave your PC.)

## Step 2 — Host it on Railway (~15 min, ~$5/month)

1. railway.app → Login with GitHub → New Project → **Deploy from GitHub repo** →
   pick `ai-receptionist`. It auto-detects Node and builds.
2. Click the service → **Variables** → add:
   - `ADMIN_KEY` = (value above)
   - `VAPI_WEBHOOK_SECRET` = (value above)
   - `DB_PATH` = `/data/receptionist.db`
   - (Google + Vapi vars come in steps 3–4)
3. **Volume** (so bookings survive restarts): right-click the service →
   Attach Volume → mount path `/data`.
4. **Settings → Networking → Generate Domain**. You get something like
   `ai-receptionist-production.up.railway.app`. Add variable:
   - `BASE_URL` = `https://ai-receptionist-production.up.railway.app` (your actual domain, no trailing slash)
5. Open `https://YOUR-DOMAIN` — you should see the login screen. Log in with the new ADMIN_KEY.

## Step 3 — Google Cloud OAuth (~15 min, free)

1. console.cloud.google.com → New project "ai-receptionist".
2. APIs & Services → Library → enable **Google Calendar API**.
3. OAuth consent screen → External → fill app name + your email → save.
   Add yourself (and any pilot customer) under **Test users**.
4. Credentials → Create credentials → **OAuth client ID** → Web application →
   Authorized redirect URI: `https://YOUR-DOMAIN/oauth/google/callback`
5. Copy the client ID and secret into Railway Variables:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
6. Note: in "Testing" mode Google limits you to 100 test users — plenty for your first
   customers. Before scaling past that, submit the app for verification (takes days,
   free).

## Step 4 — Vapi + phone number (~15 min + KYC wait)

1. vapi.ai → sign up → Dashboard → API Keys → copy the **private key** →
   Railway variable `VAPI_API_KEY`. Add ~$15 credit.
2. Phone number options:
   - **Testing now:** Vapi gives free US numbers instantly. Callable from NL (normal
     international rates for the caller) — fine for your own testing, not for customers.
   - **Dutch number (for real customers):** create a twilio.com account, buy a Dutch
     number (~€5/month). Twilio requires business/address verification for NL numbers
     (regulatory KYC — can take a few days; a KvK registration helps). Then in Vapi:
     Phone Numbers → Import from Twilio.
3. In YOUR dashboard (`https://YOUR-DOMAIN`): add the business → Koppel Google Agenda →
   **Maak AI aan**. Copy the assistant ID it reports.
4. In Vapi: Phone Numbers → your number → set **Assistant** to that assistant.
5. Call the number. Test like a difficult customer (see SETUP.md step 5).

## Step 5 — Before you charge real customers

- [ ] Full test cycle with YOUR OWN business entry for a week (real calls, real agenda).
- [ ] KvK registration if you don't have one (you're selling a B2B service).
- [ ] One-page verwerkersovereenkomst (data processing agreement) per customer — standard
      Dutch templates exist; callers' names/numbers flow through your server.
- [ ] Tell customers to mention the AI assistant in their own privacy statement.
- [ ] Pricing: €79–99/month incl. ~150 call-minutes is a defensible starter offer;
      your marginal cost is ~€0.10–0.18/minute.
- [ ] Onboard pilot customer #1 at a discount in exchange for feedback + testimonial.

## Updating the software later

Any change: commit + push to GitHub → Railway redeploys automatically.
If `BASE_URL` or prompts change, click **"Update AI"** per business in the dashboard so
the assistants get the new config.
