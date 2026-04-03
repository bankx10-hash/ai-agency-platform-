import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { forwardToLeadGen } from './meta-webhooks'
import { logger } from '../utils/logger'

const router = Router()

// POST /leads/:clientId — public endpoint for website lead capture forms
// No auth required — rate limited by global middleware
router.post('/:clientId', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params
  const { name, email, phone, source, message } = req.body as {
    name?: string; email?: string; phone?: string; source?: string; message?: string
  }

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
      source: source || 'website'
    })

    logger.info('Website lead captured', { clientId, source: source || 'website', name, email })
    res.json({ success: true, message: 'Thank you! We will be in touch shortly.' })
  } catch (err) {
    logger.error('Website lead capture failed', { clientId, err })
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
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

export default router
