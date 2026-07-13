# Deployment — status & remaining steps

Production server: **https://ai-receptionist-production-ea41.up.railway.app**

> Never put real secrets (ADMIN_KEY, API keys) in this file or anywhere in the repo —
> the repo history is visible to anyone if the repo is public. Secrets live only in
> Railway → Variables and in your local `.env`.

## Done ✔

- [x] Code on GitHub: github.com/puredoom/ai-receptionist
- [x] Railway service deployed, public domain generated
- [x] ADMIN_KEY set in Railway (admin API verified: rejects wrong keys)

## Railway variables — verify these are all set

Railway → your service → Variables:

| Variable | Value |
|---|---|
| `ADMIN_KEY` | (your secret — already set) |
| `VAPI_WEBHOOK_SECRET` | any long random string, you'll also never type this anywhere else |
| `BASE_URL` | `https://ai-receptionist-production-ea41.up.railway.app` |
| `DB_PATH` | `/data/receptionist.db` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from step 1 below |
| `VAPI_API_KEY` | from step 2 below |

Also attach a **Volume** mounted at `/data` (service → right-click → Attach Volume).
Without it, all bookings and tenants are wiped on every redeploy.

## Step 1 — Google Cloud OAuth (~15 min, free)

1. console.cloud.google.com → New project "ai-receptionist".
2. APIs & Services → Library → enable **Google Calendar API**.
3. OAuth consent screen → External → app name + your email → save.
   Add yourself (and pilot customers) under **Test users**.
4. Credentials → Create credentials → **OAuth client ID** → Web application →
   Authorized redirect URI (exact):
   `https://ai-receptionist-production-ea41.up.railway.app/oauth/google/callback`
5. Put the client ID + secret in Railway Variables (see table above).
   Railway redeploys automatically when variables change.

## Step 2 — Vapi + phone number (~15 min + KYC wait)

1. vapi.ai → sign up → API Keys → copy the **private key** → Railway `VAPI_API_KEY`.
   Add ~$15 credit.
2. Phone number:
   - **Test now:** free Vapi US number, callable from NL — fine for your own testing.
   - **Dutch number (for customers):** twilio.com → buy NL number (~€5/mo; requires
     business/address verification, can take days — KvK helps). Then Vapi →
     Phone Numbers → Import from Twilio.
3. Dashboard (`https://ai-receptionist-production-ea41.up.railway.app`, log in with your
   ADMIN_KEY): add business → **Koppel Google Agenda** → **Maak AI aan**.
4. Vapi → Phone Numbers → your number → Assistant = the ID from step 3.
5. Call it. Test hard: relative dates ("morgen", "volgende week dinsdag"), a fully
   blocked day, interrupting it, "spreek ik met een mens?", a price it can't know.
6. After each call: check Google Calendar + dashboard tabs (Afspraken / Berichten /
   Gesprekken).

## Before charging customers

- [ ] Run it on your own line for a week of real calls.
- [ ] KvK registration (B2B service).
- [ ] Verwerkersovereenkomst (standard NL template) per customer — caller data flows
      through your server.
- [ ] Customers mention the AI assistant in their privacy statement.
- [ ] Pricing: €79–99/month incl. ~150 minutes is defensible; marginal cost
      ~€0.10–0.18/min.
- [ ] Pilot customer #1 at a discount for feedback + testimonial.

## Updating the software

Commit + push to GitHub → Railway redeploys automatically.
If `BASE_URL`, prompts, or tools change: dashboard → **Update AI** per business, so each
Vapi assistant picks up the new config.
