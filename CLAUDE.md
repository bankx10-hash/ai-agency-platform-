# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A multi-tenant SaaS platform where clients subscribe and get AI agents automatically deployed, connected to their CRM, email, and communications — zero technical setup required from the client.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API | Node.js + Express + TypeScript |
| Database | PostgreSQL via Prisma ORM |
| Automation | N8N (self-hosted, API-controlled) |
| CRM | GoHighLevel (GHL) API v2 |
| Billing | Stripe subscriptions + webhooks |
| Voice | Retell AI (agents) + Twilio (phone number provisioning) |
| LinkedIn | Phantombuster + LinkedIn API |
| Social Media | Meta Graph API + Buffer API |
| Email | Gmail OAuth2 + SMTP (Nodemailer) |
| Client Portal | Next.js 14 (App Router) |
| AI/LLM | Anthropic Claude API (`claude-sonnet-4-20250514`) |
| Queue | Bull + Redis |
| Auth | NextAuth.js |
| Deployment | Docker + docker-compose |

## Monorepo Structure

```
ai-agency-platform/
├── apps/
│   ├── api/src/
│   │   ├── index.ts               # Express entry point
│   │   ├── routes/                # clients, agents, webhooks, onboarding
│   │   ├── services/              # External API wrappers (see Services below)
│   │   ├── agents/                # 9 agent definitions
│   │   ├── workflows/             # N8N JSON templates with {{VARIABLE}} placeholders
│   │   └── queue/                 # Bull workers: onboarding, agent-deploy
│   └── portal/                    # Next.js 14 client portal
│       └── app/
│           ├── (auth)/            # login, signup
│           ├── dashboard/         # main, agents, analytics, settings
│           └── onboarding/        # 3-step wizard
├── packages/shared/types/         # Shared TS interfaces (client, agent, workflow)
├── prisma/schema.prisma
└── docker/
```

## Development Commands

```bash
# Install all workspaces
npm install

# Database
npx prisma generate             # Regenerate client after schema change
npx prisma studio               # Browse DB
# WARNING: Do NOT run `npx prisma db push` against production — it will
# drop CallLog, SmsMessage, Notification tables (created by raw SQL).
# New tables must be added to runStartupMigrations() in apps/api/src/index.ts.

# API
npm run dev --workspace=apps/api        # Start API (ts-node-dev)
npm run build --workspace=apps/api      # Compile TypeScript
npm run typecheck --workspace=apps/api  # Check without emitting

# Portal
npm run dev --workspace=apps/portal     # Start Next.js dev server
npm run build --workspace=apps/portal

# Docker (full stack)
docker-compose -f docker/docker-compose.yml up -d
```

## Database Schema

Key models — see `prisma/schema.prisma` for full definition:

- **Client** — `stripeCustomerId`, `plan` (AI_RECEPTIONIST/STARTER/GROWTH/AGENCY), `status`, `crmType`
- **AgentDeployment** — `clientId`, `agentType` (enum), `status`, `n8nWorkflowId`, `config` (Json), `metrics` (Json)
- **ClientCredential** — AES-256 encrypted JSON blob per service (`gmail`, `hubspot`, `salesforce`, `zoho`, `pipedrive`, `gohighlevel`, etc.)
- **Onboarding** — tracks step (1–3) and `data` Json of what has been connected
- **UsageRecord** — `clientId`, `usageType` (enum: VOICE_MINUTES/AI_ACTIONS/SMS/EMAILS/SOCIAL_POSTS/APOLLO_PROSPECTS), `quantity`, `billingPeriodStart`, `sourceId`, `sourceType`. Created by `runStartupMigrations()` in `index.ts`, NOT by Prisma migrations.
- **CallLog**, **SmsMessage**, **Notification** — created by raw SQL in `runStartupMigrations()`, NOT in Prisma schema. Do not run `prisma db push` against production.

## Billing Plans

```typescript
AI_RECEPTIONIST  $197/mo  → VOICE_INBOUND, RECEPTIONIST_FOLLOWUP (375 voice mins, 200 AI, 100 SMS, 200 emails)
STARTER          $497/mo  → LEAD_GENERATION, APPOINTMENT_SETTER, VOICE_INBOUND, VOICE_OUTBOUND (750 voice mins, 750 AI, 300 SMS, 500 emails)
GROWTH           $797/mo  → + B2B_OUTREACH, SOCIAL_MEDIA (1,500 voice mins, 1,500 AI, 500 SMS, 1,500 emails, 15 posts, 550 Apollo)
AGENCY         $1,497/mo  → + ADVERTISING, VOICE_CLOSER, CLIENT_SERVICES (3,750 voice mins, 3,000 AI, 1,000 SMS, 3,000 emails, 30 posts, 1,000 Apollo)

Add-ons (not bundled in any plan): SOCIAL_ENGAGEMENT, CONVERSATIONAL_WORKFLOW
```

Stripe price IDs live in env vars (`STRIPE_STARTER_PRICE_ID`, etc.). When a subscription is cancelled or payment fails, all agent workflows must be paused within 60 seconds via the Stripe webhook.

## Services (`apps/api/src/services/`)

| File | Purpose |
|------|---------|
| `contact.service.ts` | **Source of truth for lead capture.** `upsertContactAndSync()` writes to internal Postgres `Contact` table first, then mirrors to whichever external CRM the client has connected via the provider registry. Supports HubSpot, Salesforce, Zoho, Pipedrive, GoHighLevel. Adding a new CRM = one adapter implementing `CrmProvider` + one entry in `CRM_PROVIDERS`. |
| `usage.service.ts` | **Usage tracking + overage billing.** `recordUsage()` (fire-and-forget) logs every billable action to `UsageRecord` table with dedup. `getUsageSummary()` aggregates per billing period vs plan limits. `OVERAGE_RATES` defines 1.5x premium rates. Dashboard at `/dashboard/usage`. |
| `n8n.service.ts` | Deploy/pause/resume/delete N8N workflows. `deployWorkflow(templateName, clientConfig)` clones template and injects client vars. Loads per-plan template files (e.g. `growth-voice-outbound.workflow.json`). |
| `stripe.service.ts` | Subscription lifecycle, webhook signature verification, metered overage billing (`reportOverageUsage()`, `addOverageItems()`). |
| `voice.service.ts` | Retell AI — create inbound/outbound agents, launch calls, fetch transcripts. Phone numbers provisioned via Twilio credentials passed to Retell's `/create-phone-number` endpoint. SIP credentials passed on import-phone-number for outbound. |
| `calendar.service.ts` | Calendar provider integrations — Google Calendar, Calendly, Cal.com. `bookAppointment()` writes to whichever provider the client connected during onboarding. No GHL calendar. |
| `email.service.ts` | Gmail OAuth2 flow + SMTP sending via Nodemailer |
| `apollo.service.ts` | Apollo.io — B2B prospect search, contact enrichment, verified emails/phones (replaces Phantombuster — no LinkedIn ban risk) |
| `social.service.ts` | **Direct posting** to Meta Graph API (Facebook + Instagram) and LinkedIn Marketing API. No Buffer integration. Posts scheduled via internal `ScheduledPost` table. |
| `encrypt.ts` | AES-256 encrypt/decrypt for `ClientCredential.credentials` |
| `onboarding.service.ts` | **Master orchestrator** — `runOnboarding()` walks `PLANS[plan].agents` and deploys each agent in sequence with a 10s stagger. Sends welcome email at the end. Phone provisioning happens **inside each voice agent's `deploy()`**, not in a separate step (the `assignVoiceNumbers()` method exists but is dead code). |
| `ghl.service.ts` | **DEAD CODE — not used anywhere.** Kept in the repo as a stub but never imported. The GoHighLevel CRM is supported as one of the *external* CRMs via `contact.service.ts`'s provider registry; this service file is unrelated. |

## Agents (`apps/api/src/agents/`)

All agents extend `base.agent.ts`. Each has a typed `Config` interface, `deploy(clientId, config)` and `teardown(deploymentId)` methods.

| Agent | Trigger | Key config fields |
|-------|---------|-------------------|
| `lead-generation` | Schedule (2h) + form webhooks | `icp_description`, `lead_sources[]`, `scoring_prompt`, `high_score_threshold` |
| `b2b-outreach` | Daily schedule (Apollo) | `person_titles[]`, `person_locations[]`, `keywords[]`, `employee_ranges[]`, `daily_limit` |
| `social-media` | Schedule + brief webhook | `business_description`, `platforms[]`, `content_pillars[]`, `posting_frequency` |
| `advertising` | Daily + budget webhooks | `meta_ad_account_id`, `target_roas`, `daily_budget_limit` |
| `appointment-setter` | Internal score-crossed webhook (lead score ≥ 70) | `followup_sequence[]` (multi-touch SMS+email), `calendar_id`, `objection_handlers{}`. SMS asks the prospect to **reply with a preferred date/time** — does not send a calendar link. |
| `voice-inbound` | Inbound call (Retell AI) | `greeting_script`, `faq_knowledge_base`, `escalation_number`, `voice_id`. Booking tools (`check_availability`, `book_appointment`) wired to the connected calendar provider. |
| `voice-outbound` | Warm-lead webhook from `n8n-callbacks` (`outbound-queue-{clientId}`) | `call_script`, `objection_handlers{}`, `max_daily_calls`, `call_window_hours`. Same booking tools as inbound. Dedicated outbound Twilio number. |
| `voice-closer` | Booking confirmation → calls at scheduled time | `closing_script_template`, `offer_details`, `payment_link`, `contract_link`. Voicemail detection + leave-message support. |
| `client-services` | New sale webhook + schedule | `welcome_sequence[]`, `onboarding_checklist[]`, `health_score_weights{}` |

Voice agent scripts are **dynamically generated by Claude AI** using the client's business description — never static.

## N8N Workflow Templates

Stored as JSON in `apps/api/src/workflows/`. Use `{{VARIABLE}}` placeholders for client-specific values (locationId, API keys, phone numbers, prompts). `n8n.service.ts` substitutes these on deploy. Never hardcode client credentials in workflow JSON.

## Onboarding Wizard (Portal)

3 steps shown after signup:
1. **Plan selection** → Stripe Checkout
2. **Connect tools** (only after payment confirmed) → Gmail OAuth, **optional** external CRM (HubSpot / Salesforce / Zoho / Pipedrive / GoHighLevel — clients can also skip and use the internal Postgres CRM only), calendar provider (Calendly / Google Calendar / Cal.com), business description, ICP textarea, voice config (greeting, escalation number, FAQ knowledge base, address for Twilio compliance), **website lead capture** (choose: embed form / listener script / webhook URL — must be configured before deploying agents)
3. **Progress screen** → animated steps, auto-redirect to dashboard on completion

Progress is tracked in the `Onboarding` model. Failed steps retry via Bull queue with exponential backoff.

## Website Lead Capture

Three options for connecting the client's website — all feed into the same pipeline (`POST /leads/{clientId}` → `forwardToLeadGen()` → N8N → AI scoring → appointment setter + outbound caller):

1. **Embed form** — `<script src="{API_URL}/leads/{clientId}/embed.js"></script>` — injects a styled lead capture form. For clients without an existing form.
2. **Listener script** — `<script src="{API_URL}/leads/{clientId}/listener.js"></script>` — attaches to existing forms on the page, silently forwards submissions via `sendBeacon()`. The original form keeps working. Supports `data-form-id` to target a specific form. Auto-detects dynamically loaded forms via `MutationObserver`.
3. **Webhook URL** — `POST {API_URL}/leads/{clientId}` — paste into any form builder's webhook settings (WordPress WPForms/Gravity Forms/CF7, Wix, Squarespace, Typeform, Jotform). Smart field-name mapping (`extractContactFields` in `leads.ts`) handles 50+ aliases across all major form builders.
4. **Social media bio link** — `{API_URL}/leads/{clientId}/page` — a mobile-optimised hosted landing page the client can link to from Instagram bio, Facebook page, Stories, ads, QR codes, SMS, etc. Clean branded form with the client's business name, success animation on submit. Source tagged as `social-bio`.

Shown in four places: onboarding connect page (before the deploy button, with pre-launch warning), welcome email (with amber reminder), dashboard settings, and social media bios.

**Welcome email also includes:** provisioned phone numbers (inbound, outbound, closer) with call-forwarding instructions. Dashboard link uses `PORTAL_URL` env var (not `NEXTAUTH_URL`) to avoid localhost links.

## Critical Constraints

- All `ClientCredential` values must be AES-256 encrypted before DB insert; decrypt only in service layer
- **Every lead/contact must be saved to the internal Postgres `Contact` table first**, then mirrored to the connected external CRM via `contact.service.ts`. Internal save is mandatory; external sync is best-effort and must never block the request. Routes must use `upsertContactAndSync()` / `syncExistingContactToCrm()` / `syncContactScoreToCrm()` / `addCallNoteToCrm()` — never hardcode `if (crmType === 'hubspot')` checks. To add a new CRM, write a `CrmProvider` adapter and register it in `CRM_PROVIDERS`.
- N8N workflow variables injected at deploy time — credentials never stored in workflow JSON
- Stripe `customer.subscription.deleted` and `invoice.payment_failed` webhooks must pause all client workflows within 60 seconds
- `AgentDeployment.metrics` (Json) must be updated after every agent run for the dashboard
- Voice agents: each outbound voice agent gets a **dedicated Twilio number** — inbound and outbound never share a number
- Voice agent prompts: behavioral preamble required so the agent doesn't read `[brackets]` or section headers aloud
- Website lead capture must be configured during onboarding **before** agents deploy — the onboarding page shows 4 options (embed form / listener script / webhook URL / social bio page) above the deploy button with a pre-launch warning. All plans get this.
- **Every billable action must be tracked** via `recordUsage()` from `usage.service.ts` — fire-and-forget (`.catch(() => {})`), never block the main action. Usage is never hard-capped — leads must never be lost. Track and bill overages at 1.5x premium via Stripe metered pricing. Dashboard at `/dashboard/usage` shows real-time usage vs plan limits.

## Environment Variables

```env
DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=
N8N_BASE_URL=http://localhost:5678
N8N_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_RECEPTIONIST_PRICE_ID=
STRIPE_STARTER_PRICE_ID=
STRIPE_GROWTH_PRICE_ID=
STRIPE_AGENCY_PRICE_ID=
RETELL_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
RETELL_SIP_AUTH_USERNAME=        # SIP creds Retell uses to auth against Twilio trunk
RETELL_SIP_AUTH_PASSWORD=        # set the same on the Twilio trunk's Credential List
APOLLO_API_KEY=                  # B2B prospecting (replaces Phantombuster)
REDIS_URL=redis://localhost:6379
ENCRYPTION_KEY=                  # 32-byte hex string for AES-256
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
PORTAL_URL=https://app.nodusaisystems.com   # used in welcome emails for dashboard link
# External CRM OAuth (clients connect their own — all optional)
HUBSPOT_CLIENT_ID=
HUBSPOT_CLIENT_SECRET=
SALESFORCE_CLIENT_ID=
SALESFORCE_CLIENT_SECRET=
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
PIPEDRIVE_CLIENT_ID=
PIPEDRIVE_CLIENT_SECRET=
GHL_CLIENT_ID=                   # GoHighLevel as an external CRM (not the dead ghl.service.ts)
GHL_CLIENT_SECRET=
# Stripe metered overage prices (create as recurring/metered/sum in Stripe dashboard)
STRIPE_OVERAGE_VOICE_PRICE_ID=
STRIPE_OVERAGE_AI_PRICE_ID=
STRIPE_OVERAGE_SMS_PRICE_ID=
STRIPE_OVERAGE_EMAIL_PRICE_ID=
STRIPE_OVERAGE_SOCIAL_PRICE_ID=
STRIPE_OVERAGE_APOLLO_PRICE_ID=
# N8N callback auth — set same value in N8N environment variables
N8N_API_SECRET=                  # shared secret between API and N8N
# Set these in N8N's environment variables (Settings → Variables)
# API_BASE_URL=https://api.nodusaisystems.com   (or http://api:4000 in Docker)
# N8N_WEBHOOK_BASE=https://your-n8n-instance.com
# META_AD_ACCOUNT_ID=     (for advertising agent)
# META_ACCESS_TOKEN=      (for advertising agent)
```

## Build Order

When building from scratch, follow this sequence:

1. Monorepo init (package.json, workspaces, tsconfig)
2. Prisma schema + initial migration
3. Shared types (`packages/shared/types/`)
4. Core services (encrypt → contact → n8n → stripe → voice → calendar → email → apollo → social → onboarding)
5. Agent definitions (all 9, with `deploy()` + `teardown()`)
6. N8N workflow JSON templates
7. Express routes (clients, agents, webhooks, onboarding)
8. Bull queue workers
9. Next.js portal (auth → onboarding wizard → dashboard → agent management)
10. Docker compose

## Testing Mode (Active)

The platform is currently in manual testing mode. The following constraints apply:

- **`assignVoiceNumbers()` is dead code** — phone provisioning happens **inside each voice agent's `deploy()`** (e.g. `voice-inbound.agent.ts:182`, `voice-outbound.agent.ts:171`), not in a separate onboarding step. Don't re-wire the old `assignVoiceNumbers()` flow.
- **Signup/registration bypassed** — clients can also be added manually via the admin endpoint. Login stores `token` + `clientId` in localStorage for onboarding pages. `PENDING` clients are redirected to `/onboarding/connect` after login.
- **Onboarding bypass** — `/onboarding/connect?clientId=xxx` accepts a URL param to skip login entirely.
- **Admin test endpoint** — `POST /admin/test-onboarding` (with `x-admin-secret` header) creates a test client and queues onboarding without Stripe.

## Deployment

- API: `https://api.nodusaisystems.com` (Railway, `docker/Dockerfile.api`)
- Portal: Railway, `apps/portal/Dockerfile` + `railway.toml`
- Deploy with `railway up` from repo root
- TypeScript built with `npx tsc || true` (type errors are non-blocking)
- Prisma client hoisted to `/app/node_modules/.prisma` due to npm workspaces
- OpenSSL included in both builder and runner stages for Prisma compatibility
