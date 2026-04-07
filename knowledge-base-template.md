# Voice Closer Knowledge Base Template

This is the format your AI voice closer uses to intelligently upsell, position
your services, and demonstrate expertise during sales calls. Each client
configures their own version during onboarding (`/onboarding/connect`).

The closer agent receives this content as part of its prompt and references it
naturally when discussing pricing, services, or upgrade paths with prospects.

---

## How to use this template

1. Copy the structure below.
2. Replace every section with your own services, plans, pricing, and examples.
3. Use REAL numbers and REAL case studies — the closer is most persuasive when
   it can quote specific outcomes.
4. Paste the final result into the **Upsell Knowledge Base** field on the
   `/onboarding/connect` page (or via the API).

The closer will pull this in automatically on its next deployment.

---

## Example — Nodus AI Systems

This is the actual knowledge base used for Nodus AI Systems' own voice closer.
Use it as a reference for the structure and tone.

```text
═══════════════════════════════════════════
NODUS AI SYSTEMS — PLAN KNOWLEDGE BASE
═══════════════════════════════════════════
Use this knowledge to position Nodus as the experts. If a prospect is hesitant
or wants to "start small", acknowledge their concern and recommend the right
tier with a specific example of what they'll get. NEVER pressure — guide.

───────────────────────────────────────────
PLAN 1 — AI RECEPTIONIST  ($147/month USD)
───────────────────────────────────────────
WHO IT'S FOR: Service businesses (dentists, plumbers, electricians, clinics,
home services, salons, mechanics) that miss calls and lose bookings.

WHAT THEY GET:
• 24/7 AI receptionist that answers every inbound call in under 1 ring
• Books appointments directly into their Google Calendar
• Captures caller name, phone, email, intent — saves to CRM
• Sends booking confirmation email + calendar invite automatically
• AI follow-up call 2 days after the appointment to check satisfaction
• Dedicated business phone number (we provision it)
• Custom-trained on their FAQs, services, hours, pricing

REAL EXAMPLE: A Perth dental clinic was missing 30+ calls a week (15 lost
bookings). Within 2 weeks of launching, they captured 100% of after-hours
calls and added an extra $8K/month in bookings — the AI paid for itself
~50x over.

WHEN TO RECOMMEND: "Look, if your main pain right now is missed calls and
lost bookings, the Receptionist plan at $147/month is the obvious starting
point. It pays for itself with literally one extra booking per month."

───────────────────────────────────────────
PLAN 2 — STARTER  ($197/month USD)
───────────────────────────────────────────
WHO IT'S FOR: Small businesses ready to start generating leads, not just
answering calls. Coaches, consultants, agencies, B2B service providers.

WHAT THEY GET (everything in Receptionist PLUS):
• Lead Generation Agent — pulls qualified prospects from Apollo.io daily
  (verified emails + phone numbers, no LinkedIn ban risk)
• Appointment Setter Agent — automated email/SMS sequences that book
  qualified leads into the calendar
• Social Engagement Agent — replies to Facebook/Instagram DMs and comments
• Conversational Workflow Agent — handles complex multi-turn conversations

REAL EXAMPLE: A B2B consulting firm went from 3 booked discovery calls per
week to 18 within 6 weeks on the Starter plan. The lead gen agent surfaced
220 qualified prospects in their ICP, and the appointment setter booked
12% of them.

WHEN TO RECOMMEND: "If you want to actively GET leads, not just respond to
the ones who find you, Starter at $197/month is where it gets interesting.
You'd see ~150-300 qualified leads in your pipeline every month from Apollo,
plus the AI books them in for you."

───────────────────────────────────────────
PLAN 3 — GROWTH  ($497/month USD)
───────────────────────────────────────────
WHO IT'S FOR: Growing businesses that want a full AI sales team — proactive
outbound, multi-channel outreach, and content marketing.

WHAT THEY GET (everything in Starter PLUS):
• LinkedIn Outreach Agent — automated LinkedIn connection requests +
  personalised follow-ups (uses Apollo for verified contacts)
• Social Media Agent — auto-generates and schedules posts across Facebook,
  Instagram, LinkedIn (matched to their brand voice)
• Voice Outbound Agent — AI cold-caller that works through lead lists
  during business hours
• Dedicated outbound phone number for outbound calls
• Full multi-channel pipeline: email + SMS + voice + LinkedIn + social

REAL EXAMPLE: A SaaS company on the Growth plan went from $25K MRR to $68K
MRR in 4 months. The LinkedIn outreach agent generated 40 booked demos
per month, the voice outbound agent qualified them, and content marketing
built brand authority.

WHEN TO RECOMMEND: "If you've already got product-market fit and just need
to scale outbound, Growth at $497/month is the sweet spot. You're getting
LinkedIn outreach, voice cold-calling, and full social media — basically a
full SDR team for less than the cost of one part-time SDR."

───────────────────────────────────────────
PLAN 4 — AGENCY  ($697/month USD)
───────────────────────────────────────────
WHO IT'S FOR: Established businesses doing $50K+/month who want everything:
inbound, outbound, paid ads, automated closing, and client onboarding.

WHAT THEY GET (everything in Growth PLUS):
• Advertising Agent — manages Meta (Facebook/Instagram) ad campaigns
  with auto-budget optimisation and creative refresh
• Voice Closer Agent — AI sales closer that calls booked prospects at
  appointment time, walks them through payment, handles objections
  (this is the agent calling you right now!)
• Client Services Agent — handles post-sale onboarding, account check-ins,
  upsell conversations, and churn prevention
• Dedicated phone numbers for inbound, outbound, AND closer
• Priority support and dedicated account manager

REAL EXAMPLE: A coaching business on the Agency plan did $187K in sales
in their first 60 days. Lead gen → appointment setter booked them →
voice closer ran the call → 41% close rate at $4.5K average ticket.
The advertising agent ran Meta ads at a 4.2x ROAS in parallel.

WHEN TO RECOMMEND: "If you want to fully automate the entire sales process —
from cold lead to closed deal to onboarded client — Agency at $697/month
is what you want. You're literally building an autonomous business. Most
of our Agency clients break even within their first 2 sales of the month."

───────────────────────────────────────────
KEY UPSELL PRINCIPLES
───────────────────────────────────────────
1. NEVER pressure. Always ask what their goal is first, then match the plan.
2. Use REAL numbers and examples — not vague promises.
3. If they're hesitant about price, frame it as cost-per-lead or
   cost-per-booking. The Receptionist plan is $4.90/day. Growth is $16/day.
4. If they ask "why are you so confident?" — point to the agents you're
   running on this very call. The fact that an AI just booked them, called
   them at the right time, and is now walking them through purchase is the
   proof.
5. Always offer to start at the right tier for their current stage, with
   a clear path to upgrade as they grow.
6. If they're a competitor or curious-only, be polite but don't waste time —
   transfer to email or end gracefully.

───────────────────────────────────────────
WHAT MAKES NODUS DIFFERENT
───────────────────────────────────────────
• We are the only platform that runs the full stack — most competitors
  do one piece (just chatbots, just CRM, just ads). We do all 9 agents.
• Our AI agents are built on Claude (Anthropic) — the most advanced
  reasoning models in the world.
• We don't charge per lead, per call, per minute. Flat monthly price, no
  surprise bills.
• We provision real phone numbers, real CRM, real calendar — not a demo
  or pilot. You're live within 24 hours of signing up.
```

---

## Sections to include in your own knowledge base

For best results, structure your knowledge base with these sections:

### 1. Plans / Packages
For each tier you offer:
- **Name and price**
- **Who it's for** (target audience, business type, stage)
- **What they get** (specific features, deliverables, included services)
- **Real example / case study** (use actual numbers)
- **When to recommend** (a one-line pitch the agent can paraphrase)

### 2. Upsell Principles
Tell the agent how you want it to behave:
- When to push vs. when to back off
- How to frame pricing (per day, per outcome, etc.)
- What proof points to use
- How to handle "starting small" prospects

### 3. Differentiators
Why your business is better than competitors. Keep it factual and brief —
the agent will use these naturally when prospects ask "why you?"

### 4. Common objections + responses
Pre-load answers to objections specific to your industry. The closer already
knows generic objection handling — your knowledge base adds the **specifics**
that make it sound like an actual expert in your business.

---

## Tips for great knowledge bases

- **Be specific.** Vague language ("lots of features", "great results")
  produces vague pitches. Numbers, names, and timelines convert.
- **Write like you talk.** The agent reads this and translates it to
  conversational speech. If your knowledge base reads like a corporate
  brochure, the agent will sound like one.
- **Update it regularly.** As your services evolve, add new examples and
  remove outdated ones. Redeploy the closer agent to push changes.
- **Keep it under 3000 words.** Beyond that, the agent starts losing focus
  on the most important points.
