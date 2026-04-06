const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, PageBreak
} = require('docx');

// Colors
const BRAND = '4F46E5';
const BRAND_LIGHT = 'EEF2FF';
const DARK = '1E1E2E';
const GRAY = '6B7280';
const GREEN = '059669';
const AMBER = 'D97706';
const RED = 'DC2626';
const WHITE = 'FFFFFF';
const LIGHT_GRAY = 'F9FAFB';
const BORDER_COLOR = 'E5E7EB';

const border = { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorders = {
  top: { style: BorderStyle.NONE, size: 0 },
  bottom: { style: BorderStyle.NONE, size: 0 },
  left: { style: BorderStyle.NONE, size: 0 },
  right: { style: BorderStyle.NONE, size: 0 }
};
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

const TABLE_WIDTH = 9360;

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ heading: level, spacing: { before: 300, after: 150 }, children: [new TextRun({ text, bold: true, font: 'Arial' })] });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    ...opts.paraOpts,
    children: [new TextRun({ text, font: 'Arial', size: 22, color: opts.color || '333333', bold: opts.bold || false, italics: opts.italics || false, ...opts.runOpts })]
  });
}

function multiPara(runs) {
  return new Paragraph({
    spacing: { after: 120 },
    children: runs.map(r => new TextRun({ font: 'Arial', size: 22, color: '333333', ...r }))
  });
}

function spacer(size = 100) {
  return new Paragraph({ spacing: { before: size, after: size }, children: [] });
}

function headerCell(text, width) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    shading: { fill: BRAND, type: ShadingType.CLEAR },
    margins: cellMargins,
    verticalAlign: 'center',
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, font: 'Arial', size: 20, color: WHITE })] })]
  });
}

function cell(text, width, opts = {}) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text: String(text), font: 'Arial', size: 20, color: opts.color || '333333', bold: opts.bold || false })] })]
  });
}

function tableRow(cells) {
  return new TableRow({ children: cells });
}

function simpleTable(headers, rows, colWidths) {
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      tableRow(headers.map((h, i) => headerCell(h, colWidths[i]))),
      ...rows.map((row, ri) =>
        tableRow(row.map((c, ci) => cell(c, colWidths[ci], { shading: ri % 2 === 1 ? LIGHT_GRAY : undefined })))
      )
    ]
  });
}

// Build the document
const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial', color: DARK },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, font: 'Arial', color: BRAND },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: DARK },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 } },
    ]
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [
        { level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '\u25E6', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ]},
      { reference: 'numbers', levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      ]},
      { reference: 'salesSteps', levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      ]},
    ]
  },
  sections: [
    // ─── COVER PAGE ──────────────────────────────────────────────
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      children: [
        spacer(3000),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [
          new TextRun({ text: 'NODUS AI SYSTEMS', font: 'Arial', size: 52, bold: true, color: BRAND })
        ]}),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [
          new TextRun({ text: 'Pricing & Packaging Strategy', font: 'Arial', size: 36, color: DARK })
        ]}),
        spacer(200),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, border: { top: { style: BorderStyle.SINGLE, size: 2, color: BRAND } }, children: [] }),
        spacer(100),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [
          new TextRun({ text: 'Complete go-to-market pricing strategy including plan structures,', font: 'Arial', size: 22, color: GRAY })
        ]}),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [
          new TextRun({ text: 'usage-based billing, add-ons, margin analysis, and sales playbook.', font: 'Arial', size: 22, color: GRAY })
        ]}),
        spacer(600),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [
          new TextRun({ text: 'CONFIDENTIAL', font: 'Arial', size: 20, bold: true, color: RED })
        ]}),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [
          new TextRun({ text: 'April 2026', font: 'Arial', size: 20, color: GRAY })
        ]}),
      ]
    },

    // ─── MAIN CONTENT ────────────────────────────────────────────
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      headers: {
        default: new Header({ children: [
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR, space: 4 } },
            children: [
              new TextRun({ text: 'Nodus AI Systems', font: 'Arial', size: 18, color: BRAND, bold: true }),
              new TextRun({ text: '  |  Pricing & Packaging Strategy', font: 'Arial', size: 18, color: GRAY }),
            ]
          })
        ]})
      },
      footers: {
        default: new Footer({ children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR, space: 4 } },
            children: [
              new TextRun({ text: 'Confidential  |  Page ', font: 'Arial', size: 16, color: GRAY }),
              new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 16, color: GRAY }),
            ]
          })
        ]})
      },
      children: [

        // ═══ SECTION 1: COST ANALYSIS ═══
        heading('1. Your Real Costs Per Client', HeadingLevel.HEADING_1),
        para('Understanding your unit economics is critical for sustainable pricing. Below is what each external service costs you per unit of usage.'),
        spacer(50),

        heading('External Service Costs', HeadingLevel.HEADING_2),
        simpleTable(
          ['Cost Item', 'Unit Cost', 'Notes'],
          [
            ['Retell AI (voice)', '$0.15\u20130.25/min', 'Voice engine + LLM + telephony combined'],
            ['Twilio phone number (AU)', '$6/mo per number', 'Mobile number, monthly recurring'],
            ['Twilio SMS (AU outbound)', '$0.052/message', 'Per SMS segment'],
            ['Claude Sonnet 4.6 API', '$3/$15 per 1M tokens', 'Input/output pricing'],
            ['Fal.ai image generation', '$0.04\u20130.10/image', 'Social post and ad creative images'],
            ['Apollo.io', '$69\u2013159/mo shared', 'B2B prospecting, verified emails + phone numbers'],
            ['N8N', 'Self-hosted or ~$50/mo', 'Workflow orchestration engine'],
          ],
          [3200, 2400, 3760]
        ),
        spacer(100),

        heading('Estimated Cost Per Client Per Month', HeadingLevel.HEADING_2),
        simpleTable(
          ['Client Tier', 'Est. Monthly Cost', 'Primary Cost Drivers'],
          [
            ['Starter (light usage)', '$15\u201330', 'Inbound voice minutes, SMS, Claude API'],
            ['Growth (moderate usage)', '$40\u201380', '+ Outbound calls, social images, Apollo prospecting'],
            ['Agency (heavy usage)', '$80\u2013180', '+ Closer calls, ad management, client services'],
          ],
          [2800, 2800, 3760]
        ),
        spacer(50),
        para('At these cost levels, all three plans deliver 80\u201390% gross margins at the proposed pricing.', { italics: true, color: GREEN }),

        new Paragraph({ children: [new PageBreak()] }),

        // ═══ SECTION 2: THE THREE PLANS ═══
        heading('2. Plan Structure', HeadingLevel.HEADING_1),
        para('Each plan is designed around a clear value proposition with a natural upgrade path. Clients start small, prove ROI, then expand.'),

        // --- STARTER ---
        spacer(100),
        new Paragraph({ spacing: { after: 60 }, children: [
          new TextRun({ text: 'STARTER', font: 'Arial', size: 32, bold: true, color: BRAND }),
          new TextRun({ text: '  \u2014  $197/month', font: 'Arial', size: 28, color: DARK }),
        ]}),
        new Paragraph({ spacing: { after: 10 }, border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: BRAND } }, children: [] }),
        para('"Your first AI employee"', { italics: true, color: BRAND }),
        para('For small businesses wanting to stop missing leads and calls. Proves the value of AI before scaling up.'),
        spacer(50),

        heading('Agents Included (5)', HeadingLevel.HEADING_3),
        simpleTable(
          ['Agent', 'What It Does'],
          [
            ['Lead Generation', 'AI scores every inbound lead against your ICP, routes hot ones instantly'],
            ['Appointment Setter', 'Auto-follows up leads via SMS/email, books directly into your calendar'],
            ['Voice Inbound', 'AI receptionist answers calls 24/7, qualifies callers, books appointments'],
            ['Social Engagement', 'Auto-replies to DMs and comments on Facebook and Instagram'],
            ['Conversational Workflow', 'Multi-step lead qualification via WhatsApp, SMS, Instagram DM'],
          ],
          [3000, 6360]
        ),
        spacer(50),

        heading('Platform Tools Included', HeadingLevel.HEADING_3),
        ...[
          'CRM with pipeline view and contact management',
          'Unified inbox (email + social DMs)',
          'Basic analytics dashboard',
          '1 calendar integration (Calendly, Google Calendar, or Cal.com)',
        ].map(t => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: t, font: 'Arial', size: 22 })] })),
        spacer(50),

        heading('Usage Allowances', HeadingLevel.HEADING_3),
        simpleTable(
          ['Resource', 'Monthly Allowance', 'Overage Rate'],
          [
            ['Voice minutes (inbound)', '100 minutes', '$0.35/min'],
            ['SMS messages', '200 messages', '$0.08/msg'],
            ['AI actions (Claude API calls)', '500 actions', '$0.05/action'],
            ['Phone numbers', '1 included', '$8/mo additional'],
          ],
          [3500, 3000, 2860]
        ),

        new Paragraph({ children: [new PageBreak()] }),

        // --- GROWTH ---
        new Paragraph({ spacing: { after: 60 }, children: [
          new TextRun({ text: 'GROWTH', font: 'Arial', size: 32, bold: true, color: GREEN }),
          new TextRun({ text: '  \u2014  $497/month', font: 'Arial', size: 28, color: DARK }),
        ]}),
        new Paragraph({ spacing: { after: 10 }, border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: GREEN } }, children: [] }),
        para('"A full sales team that never sleeps"', { italics: true, color: GREEN }),
        para('For businesses ready to actively generate and close leads across multiple channels. Everything in Starter, plus proactive outreach.'),
        spacer(50),

        heading('Additional Agents (+3)', HeadingLevel.HEADING_3),
        simpleTable(
          ['Agent', 'What It Does'],
          [
            ['B2B Prospecting (Apollo)', 'Finds ideal prospects by title/industry/location, gets verified emails + phones, sends personalised outreach'],
            ['Social Media', 'AI creates and posts branded content across Facebook, Instagram, LinkedIn'],
            ['Voice Outbound', 'Proactively calls your lead list \u2014 follows up, qualifies, and books'],
          ],
          [3000, 6360]
        ),
        spacer(50),

        heading('Additional Platform Tools', HeadingLevel.HEADING_3),
        ...[
          'Social media content calendar with AI image generation',
          'Social analytics and competitor tracking',
          'Industry news feed for content inspiration',
          'SMS and email campaign builder',
          'Marketing funnel builder',
          'B2B prospect management',
        ].map(t => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: t, font: 'Arial', size: 22 })] })),
        spacer(50),

        heading('Usage Allowances', HeadingLevel.HEADING_3),
        simpleTable(
          ['Resource', 'Monthly Allowance', 'Overage Rate'],
          [
            ['Voice minutes (inbound + outbound)', '300 minutes', '$0.30/min'],
            ['SMS messages', '500 messages', '$0.08/msg'],
            ['AI actions', '1,500 actions', '$0.04/action'],
            ['AI-generated images', '50 images', '$0.15/image'],
            ['Prospects found/day (Apollo)', '20/day', '\u2014'],
            ['Phone numbers', '2 included', '$8/mo additional'],
          ],
          [3500, 3000, 2860]
        ),

        new Paragraph({ children: [new PageBreak()] }),

        // --- AGENCY ---
        new Paragraph({ spacing: { after: 60 }, children: [
          new TextRun({ text: 'AGENCY', font: 'Arial', size: 32, bold: true, color: AMBER }),
          new TextRun({ text: '  \u2014  $997/month', font: 'Arial', size: 28, color: DARK }),
        ]}),
        new Paragraph({ spacing: { after: 10 }, border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: AMBER } }, children: [] }),
        para('"The complete AI-powered sales machine"', { italics: true, color: AMBER }),
        para('For businesses that want every part of their pipeline automated \u2014 from first touch to closed deal to client retention. Everything in Growth, plus closing and retention.'),
        spacer(50),

        heading('Additional Agents (+3)', HeadingLevel.HEADING_3),
        simpleTable(
          ['Agent', 'What It Does'],
          [
            ['Voice Closer', 'AI calls warm leads and closes the deal \u2014 sends payment link on close'],
            ['Advertising', 'Manages Meta/Google ads, optimises ROAS, auto-generates ad creatives'],
            ['Client Services', 'Automated onboarding, health scoring, churn prevention, NPS surveys'],
          ],
          [3000, 6360]
        ),
        spacer(50),

        heading('Additional Platform Tools', HeadingLevel.HEADING_3),
        ...[
          'Ad performance dashboard with ROAS tracking',
          'Client health scoring and churn risk alerts',
          'Automated welcome and onboarding sequences',
          'NPS survey scheduling and tracking',
          'Full custom workflow builder',
          'Priority support',
        ].map(t => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: t, font: 'Arial', size: 22 })] })),
        spacer(50),

        heading('Usage Allowances', HeadingLevel.HEADING_3),
        simpleTable(
          ['Resource', 'Monthly Allowance', 'Overage Rate'],
          [
            ['Voice minutes (all agents)', '600 minutes', '$0.25/min'],
            ['SMS messages', '1,000 messages', '$0.07/msg'],
            ['AI actions', '3,000 actions', '$0.03/action'],
            ['AI-generated images', '150 images', '$0.12/image'],
            ['Prospects found/day (Apollo)', '20/day', '\u2014'],
            ['Phone numbers', '3 included', '$8/mo additional'],
            ['Ad accounts managed', '2 included', '$50/mo additional'],
          ],
          [3500, 3000, 2860]
        ),

        new Paragraph({ children: [new PageBreak()] }),

        // ═══ SECTION 3: ADD-ONS ═══
        heading('3. Add-Ons (Available on Any Plan)', HeadingLevel.HEADING_1),
        para('Add-ons let clients scale specific capabilities without upgrading their entire plan. They also serve as margin boosters.'),
        spacer(50),

        simpleTable(
          ['Add-On', 'Price', 'Notes'],
          [
            ['Extra phone number', '$8/mo', 'AU mobile number via Twilio'],
            ['Voice minute top-up (100 min)', '$25 one-time', 'Cheaper than per-minute overage'],
            ['SMS top-up (500 messages)', '$30 one-time', 'Cheaper than per-message overage'],
            ['AI action top-up (1,000)', '$35 one-time', 'Cheaper than per-action overage'],
            ['Image generation pack (100)', '$10 one-time', 'Social + ad creative images'],
            ['Additional ad account', '$50/mo', 'Meta or Google Ads account'],
            ['White-label portal', '$200/mo', 'Your branding, your domain, your clients'],
            ['Dedicated account manager', '$300/mo', 'Human strategy support + monthly calls'],
          ],
          [3200, 2200, 3960]
        ),
        spacer(100),

        para('Top-up packs are priced 25\u201340% below the overage rate, making them an attractive pre-purchase. This reduces surprise bills and increases average revenue per client.', { italics: true, color: GRAY }),

        new Paragraph({ children: [new PageBreak()] }),

        // ═══ SECTION 4: MARGIN ANALYSIS ═══
        heading('4. Margin Analysis', HeadingLevel.HEADING_1),
        para('All plans are designed to deliver 80%+ gross margins at typical usage levels, with significant upside as clients approach their limits.'),
        spacer(50),

        simpleTable(
          ['Plan', 'Monthly Revenue', 'Est. Cost', 'Gross Margin', 'Margin %'],
          [
            ['Starter', '$197', '$25\u201340', '$157\u2013172', '80\u201387%'],
            ['Growth', '$497', '$50\u201390', '$407\u2013447', '82\u201390%'],
            ['Agency', '$997', '$90\u2013180', '$817\u2013907', '82\u201391%'],
          ],
          [1800, 2000, 1800, 2000, 1760]
        ),
        spacer(100),

        heading('Revenue Scaling Scenarios', HeadingLevel.HEADING_2),
        simpleTable(
          ['Scenario', '10 Clients', '25 Clients', '50 Clients', '100 Clients'],
          [
            ['All Starter ($197)', '$1,970/mo', '$4,925/mo', '$9,850/mo', '$19,700/mo'],
            ['Mix (40/40/20%)', '$3,508/mo', '$8,770/mo', '$17,540/mo', '$35,080/mo'],
            ['All Growth ($497)', '$4,970/mo', '$12,425/mo', '$24,850/mo', '$49,700/mo'],
            ['All Agency ($997)', '$9,970/mo', '$24,925/mo', '$49,850/mo', '$99,700/mo'],
          ],
          [2360, 1750, 1750, 1750, 1750]
        ),
        spacer(50),
        para('The 40/40/20 mix (40% Starter, 40% Growth, 20% Agency) is the most realistic early distribution, yielding ~$35K MRR at 100 clients.', { italics: true, color: GRAY }),

        heading('Overage Revenue Potential', HeadingLevel.HEADING_2),
        para('Usage limits are set so that ~30% of active clients will exceed at least one limit per month. At 50 clients, expect $500\u2013$1,500/mo in overage revenue on top of subscription fees. This naturally nudges clients toward the next plan where limits are higher and per-unit costs are lower.'),

        new Paragraph({ children: [new PageBreak()] }),

        // ═══ SECTION 5: PRICE ANCHORING ═══
        heading('5. Value Anchoring \u2014 What You Replace', HeadingLevel.HEADING_1),
        para('Every sales conversation should anchor against the cost of the human alternative. Your platform replaces entire roles.'),
        spacer(50),

        simpleTable(
          ['Plan', 'Replaces', 'Human Cost', 'Nodus Cost', 'Savings'],
          [
            ['Starter ($197/mo)', 'Receptionist / front desk', '$3,500\u2013$4,500/mo', '$197/mo', '94\u201396%'],
            ['Growth ($497/mo)', 'Junior SDR + social media manager', '$8,000\u2013$10,000/mo', '$497/mo', '94\u201395%'],
            ['Agency ($997/mo)', 'Sales team of 3 + ad manager', '$18,000\u2013$25,000/mo', '$997/mo', '95\u201396%'],
          ],
          [2200, 2200, 1800, 1600, 1560]
        ),
        spacer(50),
        para('Key talking point: "You\u2019re not paying for software \u2014 you\u2019re hiring a team that works 24/7, never calls in sick, and costs less than one junior employee."', { bold: true }),

        new Paragraph({ children: [new PageBreak()] }),

        // ═══ SECTION 6: SALES PLAYBOOK ═══
        heading('6. Sales Playbook \u2014 Start to Finish', HeadingLevel.HEADING_1),
        para('The complete sales journey from first touch to expansion. Each stage maps to specific platform capabilities.'),
        spacer(100),

        // Stage 1
        heading('Stage 1: Lead Capture', HeadingLevel.HEADING_2),
        ...[
          'Website lead form widget (built into the platform at /leads/capture)',
          'B2B prospecting via Apollo to find and contact ideal customers',
          'Social media content showing the platform in action (screen recordings, results)',
          'Free audit offer: "We\u2019ll show you how many leads you\u2019re missing every month"',
          'Referral programme: existing clients get 1 month free per referral that converts',
        ].map(t => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: t, font: 'Arial', size: 22 })] })),
        spacer(50),

        // Stage 2
        heading('Stage 2: Discovery Call / Demo', HeadingLevel.HEADING_2),
        ...[
          'Show the dashboard live \u2014 agents running, calls being made, posts going out',
          'Key discovery question: "How many leads do you get per month that you don\u2019t follow up on?"',
          'Multiply their answer by their average deal value = the cost of doing nothing',
          'Demo the voice inbound agent LIVE \u2014 call the number, let them hear it answer',
          'Show a real call transcript and how the AI booked an appointment',
          'Ask: "If this saved you even 5 hours a week, what would that be worth?"',
        ].map(t => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: t, font: 'Arial', size: 22 })] })),
        spacer(50),

        // Stage 3
        heading('Stage 3: The Close', HeadingLevel.HEADING_2),
        ...[
          'Always start on Starter \u2014 low commitment, immediate value, easy yes',
          'Frame it: "Let\u2019s prove it works with inbound first, then we\u2019ll expand"',
          'Offer first month at 50% off ($99) as a trial incentive if needed',
          'Send payment link immediately \u2014 momentum matters',
          'Objection "too expensive": "It\u2019s $6.50/day. Less than your morning coffee. And it\u2019s answering every call you\u2019re currently missing."',
          'Objection "need to think": "What specifically? Let me address that right now so you have all the info."',
        ].map(t => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: t, font: 'Arial', size: 22 })] })),
        spacer(50),

        // Stage 4
        heading('Stage 4: Onboarding (Automated)', HeadingLevel.HEADING_2),
        ...[
          '3-step wizard: select plan \u2192 connect tools \u2192 agents deploy automatically',
          'Day 1: Welcome email + connect tools (Gmail, calendar, CRM)',
          'Day 3: Automated check-in \u2014 "Are calls coming in? Here\u2019s your first leads."',
          'Day 7: Strategy touchpoint \u2014 "Based on your first week, here\u2019s what I\u2019d add next"',
          'The Client Services agent handles this automatically on the Agency plan',
        ].map(t => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: t, font: 'Arial', size: 22 })] })),
        spacer(50),

        // Stage 5
        heading('Stage 5: Expansion & Upsell', HeadingLevel.HEADING_2),
        ...[
          'Week 2\u20134: Show data \u2014 "You had 47 inbound calls and booked 12 appointments. Want to start calling the unconverted leads?" \u2192 Upgrade to Growth',
          'Month 2\u20133: "Your appointment setter has 23 warm leads ready. Want the closer to start calling them?" \u2192 Upgrade to Agency',
          'Month 3+: Usage grows naturally \u2192 overages appear on invoice \u2192 suggest top-up packs or next tier',
          'Quarterly business review: show total ROI (leads captured, appointments booked, deals closed) vs cost',
          'Key metric: if a Starter client books 3+ appointments/month, they\u2019re ready for Growth',
        ].map(t => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: t, font: 'Arial', size: 22 })] })),

        new Paragraph({ children: [new PageBreak()] }),

        // ═══ SECTION 7: FUTURE LEVERAGE ═══
        heading('7. Future Revenue Levers (Not in Plans)', HeadingLevel.HEADING_1),
        para('These capabilities should be held back from plans and sold separately as the platform matures.'),
        spacer(50),

        simpleTable(
          ['Feature', 'Pricing Model', 'When to Launch'],
          [
            ['Custom voice cloning', '$50\u2013100/mo per voice', 'When demand appears from Agency clients'],
            ['Multi-location support', '$100/mo per additional location', 'When first multi-location client signs'],
            ['API access for agencies', '$200/mo + usage', 'When agency/reseller interest emerges'],
            ['Dedicated phone per agent', '$8/mo per number', 'Available now as add-on'],
            ['Custom N8N workflows', '$150/hr professional services', 'On request, billed hourly'],
            ['Advanced reporting/exports', '$50/mo', 'Q3 2026'],
          ],
          [3000, 3200, 3160]
        ),

        spacer(200),

        // ═══ SECTION 8: PLAN COMPARISON ═══
        heading('8. Plan Comparison at a Glance', HeadingLevel.HEADING_1),
        spacer(50),

        simpleTable(
          ['Feature', 'Starter $197', 'Growth $497', 'Agency $997'],
          [
            ['Lead Generation', '\u2713', '\u2713', '\u2713'],
            ['Appointment Setter', '\u2713', '\u2713', '\u2713'],
            ['Voice Inbound (AI receptionist)', '\u2713', '\u2713', '\u2713'],
            ['Social Engagement (DM replies)', '\u2713', '\u2713', '\u2713'],
            ['Conversational Workflows', '\u2713', '\u2713', '\u2713'],
            ['B2B Prospecting (Apollo)', '\u2014', '\u2713', '\u2713'],
            ['Social Media (content creation)', '\u2014', '\u2713', '\u2713'],
            ['Voice Outbound (proactive calls)', '\u2014', '\u2713', '\u2713'],
            ['Voice Closer (closes deals)', '\u2014', '\u2014', '\u2713'],
            ['Advertising (Meta/Google)', '\u2014', '\u2014', '\u2713'],
            ['Client Services (retention)', '\u2014', '\u2014', '\u2713'],
            ['Voice minutes included', '100', '300', '600'],
            ['SMS messages included', '200', '500', '1,000'],
            ['AI actions included', '500', '1,500', '3,000'],
            ['Phone numbers included', '1', '2', '3'],
            ['AI image generation', '\u2014', '50/mo', '150/mo'],
            ['CRM + Pipeline', '\u2713', '\u2713', '\u2713'],
            ['Content calendar', '\u2014', '\u2713', '\u2713'],
            ['Funnel builder', '\u2014', '\u2713', '\u2713'],
            ['Ad dashboard', '\u2014', '\u2014', '\u2713'],
            ['Priority support', '\u2014', '\u2014', '\u2713'],
          ],
          [3500, 1950, 1950, 1960]
        ),

        spacer(200),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [
          new TextRun({ text: '\u2014 End of Strategy Document \u2014', font: 'Arial', size: 20, color: GRAY, italics: true })
        ]}),
      ]
    }
  ]
});

// Generate the file
Packer.toBuffer(doc).then(buffer => {
  const outPath = 'C:/Users/bankx/Documents/ai-agency-platform-master/Nodus-Pricing-Strategy.docx';
  fs.writeFileSync(outPath, buffer);
  console.log('Created: ' + outPath);
});
