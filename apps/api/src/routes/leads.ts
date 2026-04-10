import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { forwardToLeadGen } from './meta-webhooks'
import { logger } from '../utils/logger'

const router = Router()

// ── Smart field extraction ───────────────────────────────────────────────────
// Maps common field names from popular form builders (WordPress Contact Form 7,
// WPForms, Gravity Forms, Wix, Squarespace, Typeform, Jotform, etc.) to our
// canonical fields. This lets the webhook endpoint accept payloads from any
// form builder without the client needing to rename fields.
function extractField(body: Record<string, unknown>, aliases: string[]): string {
  for (const alias of aliases) {
    // Try exact match first
    if (body[alias] && typeof body[alias] === 'string') return body[alias] as string
    // Try case-insensitive / underscore-dash variants
    const lower = alias.toLowerCase()
    for (const [key, val] of Object.entries(body)) {
      if (typeof val === 'string' && val.trim() && key.toLowerCase().replace(/[-_\s]/g, '') === lower.replace(/[-_\s]/g, '')) {
        return val.trim()
      }
    }
  }
  return ''
}

function extractContactFields(body: Record<string, unknown>): { name: string; email: string; phone: string; message: string } {
  const name = extractField(body, [
    'name', 'full_name', 'fullName', 'your-name', 'your_name',
    'contact_name', 'contactName', 'first_name', 'firstName',
    'Name', 'Full Name', 'Your Name', 'input_1', 'field_1'
  ])
  const lastName = extractField(body, [
    'last_name', 'lastName', 'surname', 'Last Name', 'input_2', 'field_2'
  ])
  const fullName = lastName ? `${name} ${lastName}`.trim() : name

  const email = extractField(body, [
    'email', 'your-email', 'your_email', 'email_address', 'emailAddress',
    'Email', 'Email Address', 'Your Email', 'input_3', 'field_3',
    'contact_email', 'contactEmail', 'e-mail'
  ])
  const phone = extractField(body, [
    'phone', 'your-phone', 'your_phone', 'phone_number', 'phoneNumber',
    'tel', 'telephone', 'mobile', 'cell', 'Phone', 'Phone Number',
    'Your Phone', 'input_4', 'field_4', 'contact_phone', 'contactPhone'
  ])
  const message = extractField(body, [
    'message', 'your-message', 'your_message', 'comments', 'comment',
    'enquiry', 'inquiry', 'details', 'description', 'notes', 'note',
    'Message', 'Your Message', 'How can we help?', 'input_5', 'field_5',
    'textarea-1', 'body', 'content'
  ])

  return { name: fullName, email, phone, message }
}

// POST /leads/:clientId — public endpoint for website lead capture
// Accepts payloads from our embed form, custom forms, and any webhook-enabled
// form builder (WordPress, Wix, Squarespace, Typeform, Gravity Forms, etc.)
// No auth required — rate limited by global middleware
router.post('/:clientId', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params
  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>

  // Smart field extraction — handles different naming conventions
  const { name, email, phone, message } = extractContactFields(body)
  const source = (body.source as string) || (body.utm_source as string) || 'website'

  // Must have at least one contact field
  if (!name && !email && !phone) {
    res.status(400).json({ error: 'At least one of name, email, or phone is required' })
    return
  }

  try {
    // Verify client exists
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, status: true } })
    if (!client) {
      res.status(404).json({ error: 'Invalid form' })
      return
    }

    await forwardToLeadGen(clientId, {
      name: name || '',
      email: email || '',
      phone: phone || '',
      source
    })

    logger.info('Website lead captured', { clientId, source, name, email })
    res.json({ success: true, message: 'Thank you! We will be in touch shortly.' })
  } catch (err) {
    logger.error('Website lead capture failed', { clientId, err })
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

// GET /leads/:clientId/listener.js — attaches to existing forms on the page
// Silently captures submissions and forwards them to the AI pipeline in the
// background. The original form still submits normally — we just piggyback.
// Client adds: <script src=".../leads/{clientId}/listener.js"></script>
// Optionally add data-form-id="myFormId" to target a specific form.
router.get('/:clientId/listener.js', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params
  const apiBase = process.env.API_URL || 'https://api.nodusaisystems.com'

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } })
  if (!client) {
    res.status(404).type('application/javascript').send('console.error("Nodus: Invalid form ID");')
    return
  }

  res.type('application/javascript').send(`
(function() {
  var ENDPOINT = "${apiBase}/leads/${clientId}";
  var scriptTag = document.currentScript;
  var targetFormId = scriptTag && scriptTag.getAttribute("data-form-id");

  // Common field-name aliases — we try each until we find a value
  var NAME_FIELDS = ["name","full_name","fullName","your-name","your_name","contact_name","first_name","firstName","input_1","field_1"];
  var EMAIL_FIELDS = ["email","your-email","your_email","email_address","emailAddress","contact_email","input_3","field_3","e-mail"];
  var PHONE_FIELDS = ["phone","your-phone","your_phone","phone_number","phoneNumber","tel","telephone","mobile","cell","input_4","field_4"];
  var MSG_FIELDS = ["message","your-message","your_message","comments","enquiry","inquiry","details","description","textarea-1","input_5","field_5"];

  function findField(form, aliases) {
    for (var i = 0; i < aliases.length; i++) {
      var el = form.elements[aliases[i]];
      if (el && el.value) return el.value.trim();
      // Try querySelector for name attribute
      var byName = form.querySelector("[name*='" + aliases[i] + "']");
      if (byName && byName.value) return byName.value.trim();
    }
    return "";
  }

  function captureForm(form) {
    if (form._nodusListening) return;
    form._nodusListening = true;
    form.addEventListener("submit", function() {
      var data = {
        name: findField(form, NAME_FIELDS),
        email: findField(form, EMAIL_FIELDS),
        phone: findField(form, PHONE_FIELDS),
        message: findField(form, MSG_FIELDS),
        source: "website-listener"
      };
      if (!data.name && !data.email && !data.phone) return;
      // Fire-and-forget — don't interfere with the original form submission
      try {
        navigator.sendBeacon(ENDPOINT, new Blob([JSON.stringify(data)], {type: "application/json"}));
      } catch(e) {
        var x = new XMLHttpRequest();
        x.open("POST", ENDPOINT, true);
        x.setRequestHeader("Content-Type", "application/json");
        x.send(JSON.stringify(data));
      }
    });
  }

  function init() {
    if (targetFormId) {
      var f = document.getElementById(targetFormId);
      if (f && f.tagName === "FORM") captureForm(f);
    } else {
      var forms = document.querySelectorAll("form");
      for (var i = 0; i < forms.length; i++) captureForm(forms[i]);
    }
  }

  // Run now and also observe for dynamically loaded forms
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Watch for new forms added to the DOM (single-page apps, modals, etc.)
  if (window.MutationObserver) {
    new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].tagName === "FORM") captureForm(added[j]);
          if (added[j].querySelectorAll) {
            var nested = added[j].querySelectorAll("form");
            for (var k = 0; k < nested.length; k++) captureForm(nested[k]);
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
})();
`)
})

// GET /leads/:clientId/embed.js — embeddable lead capture widget
router.get('/:clientId/embed.js', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params
  const apiBase = process.env.API_URL || 'https://api.nodusaisystems.com'

  // Verify client exists and get business name for the form
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, businessName: true } })
  if (!client) {
    res.status(404).type('application/javascript').send('console.error("Nodus: Invalid form ID");')
    return
  }

  const businessName = client.businessName || 'us'

  res.type('application/javascript').send(`
(function() {
  var ENDPOINT = "${apiBase}/leads/${clientId}";
  var container = document.getElementById("nodus-lead-form");
  if (!container) {
    container = document.createElement("div");
    container.id = "nodus-lead-form";
    document.currentScript.parentNode.insertBefore(container, document.currentScript.nextSibling);
  }

  container.innerHTML = '<form id="nodus-form" style="max-width:450px;font-family:Arial,sans-serif">'
    + '<h3 style="margin:0 0 16px;color:#333">Get in touch with ${businessName.replace(/'/g, "\\'")}</h3>'
    + '<input name="name" placeholder="Your name" required style="width:100%;padding:10px;margin-bottom:10px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;font-size:14px">'
    + '<input name="email" type="email" placeholder="Email address" required style="width:100%;padding:10px;margin-bottom:10px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;font-size:14px">'
    + '<input name="phone" type="tel" placeholder="Phone number" style="width:100%;padding:10px;margin-bottom:10px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;font-size:14px">'
    + '<textarea name="message" placeholder="How can we help?" rows="3" style="width:100%;padding:10px;margin-bottom:10px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;font-size:14px;resize:vertical"></textarea>'
    + '<button type="submit" style="width:100%;padding:12px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:6px;font-size:16px;font-weight:bold;cursor:pointer">Submit</button>'
    + '<p id="nodus-msg" style="margin:10px 0 0;font-size:14px;display:none"></p>'
    + '</form>';

  document.getElementById("nodus-form").addEventListener("submit", function(e) {
    e.preventDefault();
    var form = e.target;
    var btn = form.querySelector("button");
    var msg = document.getElementById("nodus-msg");
    btn.disabled = true;
    btn.textContent = "Sending...";
    msg.style.display = "none";

    var data = {
      name: form.name.value,
      email: form.email.value,
      phone: form.phone.value,
      message: form.message.value,
      source: "website-embed"
    };

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      msg.style.display = "block";
      if (res.success) {
        msg.style.color = "#22c55e";
        msg.textContent = res.message || "Thank you! We will be in touch shortly.";
        form.reset();
      } else {
        msg.style.color = "#ef4444";
        msg.textContent = res.error || "Something went wrong.";
      }
      btn.disabled = false;
      btn.textContent = "Submit";
    })
    .catch(function() {
      msg.style.display = "block";
      msg.style.color = "#ef4444";
      msg.textContent = "Network error. Please try again.";
      btn.disabled = false;
      btn.textContent = "Submit";
    });
  });
})();
`)
})

// GET /leads/:clientId/page — hosted landing page for social media bios
// A clean, mobile-optimised lead capture page the client can link to from
// Instagram bio, Facebook bio, Stories, QR codes, SMS, ads, etc. Every
// submission flows into the same AI pipeline as the embed/listener/webhook.
router.get('/:clientId/page', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params
  const apiBase = process.env.API_URL || 'https://api.nodusaisystems.com'

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, businessName: true, status: true }
  })
  if (!client) {
    res.status(404).send('<html><body><h1>Page not found</h1></body></html>')
    return
  }

  const biz = client.businessName || 'us'
  const bizEsc = biz.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  res.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>Contact ${bizEsc}</title>
  <meta name="description" content="Get in touch with ${bizEsc}. We'll get back to you shortly.">
  <meta property="og:title" content="Contact ${bizEsc}">
  <meta property="og:description" content="Get in touch with ${bizEsc}. Fill out the form and we'll get back to you shortly.">
  <meta property="og:type" content="website">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.15);
      width: 100%;
      max-width: 420px;
      padding: 36px 28px 28px;
    }
    .logo-area {
      text-align: center;
      margin-bottom: 24px;
    }
    .logo-area h1 {
      font-size: 22px;
      font-weight: 700;
      color: #1a1a2e;
      margin-bottom: 6px;
    }
    .logo-area p {
      font-size: 14px;
      color: #6b7280;
    }
    .field {
      margin-bottom: 14px;
    }
    .field label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 5px;
    }
    .field input, .field textarea {
      width: 100%;
      padding: 12px 14px;
      border: 1.5px solid #d1d5db;
      border-radius: 10px;
      font-size: 15px;
      color: #111;
      background: #f9fafb;
      transition: border-color 0.2s;
      -webkit-appearance: none;
    }
    .field input:focus, .field textarea:focus {
      outline: none;
      border-color: #667eea;
      background: #fff;
    }
    .field textarea {
      resize: vertical;
      min-height: 80px;
    }
    .submit-btn {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: #fff;
      border: none;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.2s;
      margin-top: 6px;
    }
    .submit-btn:active { opacity: 0.85; }
    .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .msg {
      text-align: center;
      font-size: 14px;
      margin-top: 14px;
      display: none;
    }
    .msg.success { color: #059669; display: block; }
    .msg.error { color: #dc2626; display: block; }
    .success-state .card-form { display: none; }
    .success-state .thank-you { display: flex !important; }
    .thank-you {
      display: none;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 20px 0;
    }
    .thank-you svg { margin-bottom: 16px; }
    .thank-you h2 { font-size: 20px; color: #059669; margin-bottom: 8px; }
    .thank-you p { font-size: 14px; color: #6b7280; line-height: 1.5; }
    .powered {
      text-align: center;
      margin-top: 20px;
      font-size: 11px;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <div class="card" id="card">
    <div class="logo-area">
      <h1>${bizEsc}</h1>
      <p>Get in touch — we'll get back to you shortly</p>
    </div>

    <form id="lead-form" class="card-form">
      <div class="field">
        <label for="name">Your name</label>
        <input type="text" id="name" name="name" required autocomplete="name" placeholder="John Smith">
      </div>
      <div class="field">
        <label for="email">Email address</label>
        <input type="email" id="email" name="email" required autocomplete="email" placeholder="john@example.com">
      </div>
      <div class="field">
        <label for="phone">Phone number</label>
        <input type="tel" id="phone" name="phone" autocomplete="tel" placeholder="+61 400 000 000">
      </div>
      <div class="field">
        <label for="message">How can we help?</label>
        <textarea id="message" name="message" rows="3" placeholder="Tell us a bit about what you need..."></textarea>
      </div>
      <button type="submit" class="submit-btn" id="submit-btn">Send enquiry</button>
      <div class="msg" id="msg"></div>
    </form>

    <div class="thank-you">
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
        <circle cx="28" cy="28" r="28" fill="#D1FAE5"/>
        <path d="M20 29l6 6 10-12" stroke="#059669" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <h2>Thank you!</h2>
      <p>We've received your enquiry and will be in touch shortly.</p>
    </div>

    <div class="powered">Powered by Nodus AI</div>
  </div>

  <script>
    document.getElementById("lead-form").addEventListener("submit", function(e) {
      e.preventDefault();
      var btn = document.getElementById("submit-btn");
      var msg = document.getElementById("msg");
      btn.disabled = true;
      btn.textContent = "Sending...";
      msg.className = "msg";

      fetch("${apiBase}/leads/${clientId}", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: document.getElementById("name").value,
          email: document.getElementById("email").value,
          phone: document.getElementById("phone").value,
          message: document.getElementById("message").value,
          source: "social-bio"
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success) {
          document.getElementById("card").classList.add("success-state");
        } else {
          msg.className = "msg error";
          msg.textContent = res.error || "Something went wrong. Please try again.";
          btn.disabled = false;
          btn.textContent = "Send enquiry";
        }
      })
      .catch(function() {
        msg.className = "msg error";
        msg.textContent = "Network error. Please try again.";
        btn.disabled = false;
        btn.textContent = "Send enquiry";
      });
    });
  </script>
</body>
</html>`)
})

export default router
