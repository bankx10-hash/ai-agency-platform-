/**
 * Contact service — single source of truth for saving leads/contacts.
 *
 * RULE: Every lead, no matter where it comes from (N8N callbacks, voice
 * inbound, manual dashboard entry, public funnel submissions, etc.) MUST
 * land in the internal Postgres CRM first. If the client has an external
 * CRM connected, the contact is ALSO mirrored there.
 *
 * Supported external CRMs: HubSpot, Salesforce, Zoho, Pipedrive,
 * GoHighLevel. Adding a new CRM = writing one provider adapter and
 * registering it in CRM_PROVIDERS — no route changes required.
 *
 * Use `upsertContactAndSync()` for new leads. Use `syncExistingContactToCrm()`
 * if you've already written to Postgres and just need to push to the
 * connected external CRM. Use `syncContactScoreToCrm()` after a lead score
 * update. Use `addCallNoteToCrm()` after a call to push a transcript note.
 */

import axios from 'axios'
import { randomUUID } from 'crypto'
import { prisma } from '../lib/prisma'
import { encryptJSON, decryptJSON } from '../utils/encrypt'
import { logger } from '../utils/logger'

// ── Public types ─────────────────────────────────────────────────────────────

export interface ContactInput {
  name?: string | null
  email?: string | null
  phone?: string | null
  source?: string | null
}

export interface NormalizedContact {
  name: string
  email: string
  phone: string
  source: string
}

export interface CrmProvider {
  /** Lowercased identifier matching `Client.crmType`. */
  id: string
  /** Create or upsert a contact in the external CRM. Returns the external ID. */
  createContact(clientId: string, data: NormalizedContact): Promise<string>
  /** Push a lead-status / score update to the external CRM. */
  updateLeadStatus?(clientId: string, externalId: string, score: number): Promise<void>
  /** Attach a free-text note (call summary, transcript, etc.) to a contact. */
  addNote?(clientId: string, externalId: string, body: string): Promise<void>
}

// ── CRM type / credential helpers ────────────────────────────────────────────

export async function getClientCrmType(clientId: string): Promise<string> {
  try {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { crmType: true } })
    return (client?.crmType || 'internal').toLowerCase()
  } catch {
    return 'internal'
  }
}

async function getCrmCredentials<T>(clientId: string, service: string): Promise<T | null> {
  try {
    const cred = await prisma.clientCredential.findFirst({ where: { clientId, service } })
    if (!cred) return null
    return decryptJSON<T>(cred.credentials)
  } catch {
    return null
  }
}

// ── HubSpot provider ─────────────────────────────────────────────────────────

async function refreshHubSpotToken(clientId: string, refreshToken: string): Promise<string> {
  const res = await axios.post(
    'https://api.hubapi.com/oauth/v1/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.HUBSPOT_CLIENT_ID || '',
      client_secret: process.env.HUBSPOT_CLIENT_SECRET || '',
      refresh_token: refreshToken
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )
  const { access_token, refresh_token } = res.data
  const cred = await prisma.clientCredential.findFirst({ where: { clientId, service: 'hubspot' } })
  if (cred) {
    await prisma.clientCredential.update({
      where: { id: cred.id },
      data: { credentials: encryptJSON({ accessToken: access_token, refreshToken: refresh_token }) }
    })
  }
  logger.info('HubSpot token refreshed', { clientId })
  return access_token as string
}

export async function getHubSpotToken(clientId: string): Promise<string | null> {
  const creds = await getCrmCredentials<{ accessToken: string; refreshToken: string }>(clientId, 'hubspot')
  if (!creds?.accessToken) return null
  if (!creds.refreshToken) return creds.accessToken
  try {
    return await refreshHubSpotToken(clientId, creds.refreshToken)
  } catch {
    return creds.accessToken
  }
}

export async function hubspotCreateContact(
  accessToken: string,
  data: { name: string; phone: string; email: string; source: string }
): Promise<string> {
  const [firstname, ...rest] = (data.name || 'Unknown').split(' ')
  const lastname = rest.join(' ') || ''
  try {
    const res = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/contacts',
      {
        properties: {
          firstname,
          lastname,
          ...(data.email && { email: data.email }),
          ...(data.phone && { phone: data.phone }),
          hs_lead_status: 'NEW'
        }
      },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    )
    return String(res.data.id)
  } catch (err) {
    const hsErr = (err as { response?: { status?: number; data?: { message?: string } } })?.response
    if (hsErr?.status === 409 && hsErr?.data?.message) {
      const match = hsErr.data.message.match(/Existing ID:\s*(\d+)/)
      if (match) return match[1]
    }
    throw err
  }
}

export async function hubspotAddNote(accessToken: string, contactId: string, body: string): Promise<void> {
  const noteRes = await axios.post(
    'https://api.hubapi.com/crm/v3/objects/notes',
    { properties: { hs_note_body: body, hs_timestamp: String(Date.now()) } },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  )
  const noteId = noteRes.data.id
  await axios.put(
    `https://api.hubapi.com/crm/v3/objects/notes/${noteId}/associations/contacts/${contactId}/202`,
    {},
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
}

const hubspotProvider: CrmProvider = {
  id: 'hubspot',
  async createContact(clientId, data) {
    const token = await getHubSpotToken(clientId)
    if (!token) throw new Error('HubSpot token missing')
    return hubspotCreateContact(token, data)
  },
  async updateLeadStatus(clientId, externalId, score) {
    const token = await getHubSpotToken(clientId)
    if (!token) return
    const hsStatus = score >= 70 ? 'IN_PROGRESS' : score >= 40 ? 'OPEN' : 'UNQUALIFIED'
    await axios.patch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${externalId}`,
      { properties: { hs_lead_status: hsStatus } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    )
  },
  async addNote(clientId, externalId, body) {
    const token = await getHubSpotToken(clientId)
    if (!token) return
    await hubspotAddNote(token, externalId, body)
  }
}

// ── Salesforce provider ──────────────────────────────────────────────────────

interface SalesforceCreds { accessToken: string; instanceUrl: string; refreshToken?: string }

async function getSalesforceCreds(clientId: string): Promise<SalesforceCreds | null> {
  return getCrmCredentials<SalesforceCreds>(clientId, 'salesforce')
}

const salesforceProvider: CrmProvider = {
  id: 'salesforce',
  async createContact(clientId, data) {
    const creds = await getSalesforceCreds(clientId)
    if (!creds?.accessToken || !creds.instanceUrl) throw new Error('Salesforce credentials missing')
    const [firstName, ...rest] = (data.name || 'Unknown').split(' ')
    const lastName = rest.join(' ') || 'Unknown'
    const res = await axios.post(
      `${creds.instanceUrl}/services/data/v59.0/sobjects/Lead`,
      {
        FirstName: firstName,
        LastName: lastName,
        Email: data.email || undefined,
        Phone: data.phone || undefined,
        Company: data.source || 'Unknown',
        LeadSource: data.source || 'Web',
        Status: 'Open - Not Contacted'
      },
      { headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' } }
    )
    return String(res.data.id)
  },
  async updateLeadStatus(clientId, externalId, score) {
    const creds = await getSalesforceCreds(clientId)
    if (!creds?.accessToken || !creds.instanceUrl) return
    const status = score >= 70 ? 'Working - Contacted' : score >= 40 ? 'Open - Not Contacted' : 'Closed - Not Converted'
    await axios.patch(
      `${creds.instanceUrl}/services/data/v59.0/sobjects/Lead/${externalId}`,
      { Status: status, Rating: score >= 70 ? 'Hot' : score >= 40 ? 'Warm' : 'Cold' },
      { headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' } }
    )
  },
  async addNote(clientId, externalId, body) {
    const creds = await getSalesforceCreds(clientId)
    if (!creds?.accessToken || !creds.instanceUrl) return
    await axios.post(
      `${creds.instanceUrl}/services/data/v59.0/sobjects/Note`,
      { ParentId: externalId, Title: 'AI Agent Activity', Body: body.slice(0, 32000) },
      { headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' } }
    )
  }
}

// ── Zoho CRM provider ────────────────────────────────────────────────────────

interface ZohoCreds { accessToken: string; refreshToken?: string; apiDomain?: string }

async function getZohoCreds(clientId: string): Promise<ZohoCreds | null> {
  return getCrmCredentials<ZohoCreds>(clientId, 'zoho')
}

const zohoProvider: CrmProvider = {
  id: 'zoho',
  async createContact(clientId, data) {
    const creds = await getZohoCreds(clientId)
    if (!creds?.accessToken) throw new Error('Zoho credentials missing')
    const apiDomain = creds.apiDomain || 'https://www.zohoapis.com'
    const [firstName, ...rest] = (data.name || 'Unknown').split(' ')
    const lastName = rest.join(' ') || 'Unknown'
    const res = await axios.post(
      `${apiDomain}/crm/v2/Leads`,
      {
        data: [{
          First_Name: firstName,
          Last_Name: lastName,
          Email: data.email || undefined,
          Phone: data.phone || undefined,
          Lead_Source: data.source || 'Web',
          Lead_Status: 'New'
        }]
      },
      { headers: { Authorization: `Zoho-oauthtoken ${creds.accessToken}`, 'Content-Type': 'application/json' } }
    )
    return String(res.data?.data?.[0]?.details?.id || '')
  },
  async updateLeadStatus(clientId, externalId, score) {
    const creds = await getZohoCreds(clientId)
    if (!creds?.accessToken) return
    const apiDomain = creds.apiDomain || 'https://www.zohoapis.com'
    const status = score >= 70 ? 'Contacted' : score >= 40 ? 'Attempted to Contact' : 'Not Contacted'
    await axios.put(
      `${apiDomain}/crm/v2/Leads/${externalId}`,
      { data: [{ Lead_Status: status, Rating: score >= 70 ? 'Hot' : score >= 40 ? 'Warm' : 'Cold' }] },
      { headers: { Authorization: `Zoho-oauthtoken ${creds.accessToken}`, 'Content-Type': 'application/json' } }
    )
  },
  async addNote(clientId, externalId, body) {
    const creds = await getZohoCreds(clientId)
    if (!creds?.accessToken) return
    const apiDomain = creds.apiDomain || 'https://www.zohoapis.com'
    await axios.post(
      `${apiDomain}/crm/v2/Notes`,
      { data: [{ Note_Title: 'AI Agent Activity', Note_Content: body.slice(0, 32000), Parent_Id: externalId, se_module: 'Leads' }] },
      { headers: { Authorization: `Zoho-oauthtoken ${creds.accessToken}`, 'Content-Type': 'application/json' } }
    )
  }
}

// ── Pipedrive provider ───────────────────────────────────────────────────────

interface PipedriveCreds { apiToken: string; companyDomain: string }

async function getPipedriveCreds(clientId: string): Promise<PipedriveCreds | null> {
  return getCrmCredentials<PipedriveCreds>(clientId, 'pipedrive')
}

const pipedriveProvider: CrmProvider = {
  id: 'pipedrive',
  async createContact(clientId, data) {
    const creds = await getPipedriveCreds(clientId)
    if (!creds?.apiToken || !creds.companyDomain) throw new Error('Pipedrive credentials missing')
    const base = `https://${creds.companyDomain}.pipedrive.com/api/v1`
    const res = await axios.post(
      `${base}/persons?api_token=${creds.apiToken}`,
      {
        name: data.name || 'Unknown',
        email: data.email ? [{ value: data.email, primary: true }] : undefined,
        phone: data.phone ? [{ value: data.phone, primary: true }] : undefined
      }
    )
    return String(res.data?.data?.id || '')
  },
  async updateLeadStatus(clientId, externalId, score) {
    const creds = await getPipedriveCreds(clientId)
    if (!creds?.apiToken || !creds.companyDomain) return
    const base = `https://${creds.companyDomain}.pipedrive.com/api/v1`
    const label = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold'
    await axios.put(`${base}/persons/${externalId}?api_token=${creds.apiToken}`, { label })
  },
  async addNote(clientId, externalId, body) {
    const creds = await getPipedriveCreds(clientId)
    if (!creds?.apiToken || !creds.companyDomain) return
    const base = `https://${creds.companyDomain}.pipedrive.com/api/v1`
    await axios.post(`${base}/notes?api_token=${creds.apiToken}`, {
      content: body.slice(0, 32000),
      person_id: Number(externalId)
    })
  }
}

// ── GoHighLevel provider ─────────────────────────────────────────────────────

interface GhlCreds { accessToken: string; locationId: string; refreshToken?: string }

async function getGhlCreds(clientId: string): Promise<GhlCreds | null> {
  return getCrmCredentials<GhlCreds>(clientId, 'gohighlevel')
}

const ghlProvider: CrmProvider = {
  id: 'gohighlevel',
  async createContact(clientId, data) {
    const creds = await getGhlCreds(clientId)
    if (!creds?.accessToken || !creds.locationId) throw new Error('GoHighLevel credentials missing')
    const [firstName, ...rest] = (data.name || 'Unknown').split(' ')
    const lastName = rest.join(' ') || ''
    const res = await axios.post(
      'https://services.leadconnectorhq.com/contacts/',
      {
        firstName,
        lastName,
        email: data.email || undefined,
        phone: data.phone || undefined,
        locationId: creds.locationId,
        source: data.source || 'AI Agent'
      },
      { headers: { Authorization: `Bearer ${creds.accessToken}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
    )
    return String(res.data?.contact?.id || '')
  },
  async updateLeadStatus(clientId, externalId, score) {
    const creds = await getGhlCreds(clientId)
    if (!creds?.accessToken) return
    const tag = score >= 70 ? 'hot-lead' : score >= 40 ? 'warm-lead' : 'cold-lead'
    await axios.put(
      `https://services.leadconnectorhq.com/contacts/${externalId}`,
      { tags: [tag] },
      { headers: { Authorization: `Bearer ${creds.accessToken}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
    )
  },
  async addNote(clientId, externalId, body) {
    const creds = await getGhlCreds(clientId)
    if (!creds?.accessToken) return
    await axios.post(
      `https://services.leadconnectorhq.com/contacts/${externalId}/notes`,
      { body: body.slice(0, 32000) },
      { headers: { Authorization: `Bearer ${creds.accessToken}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
    )
  }
}

// ── Provider registry ────────────────────────────────────────────────────────

const CRM_PROVIDERS: Record<string, CrmProvider> = {
  hubspot: hubspotProvider,
  salesforce: salesforceProvider,
  zoho: zohoProvider,
  pipedrive: pipedriveProvider,
  gohighlevel: ghlProvider
}

function getProvider(crmType: string): CrmProvider | undefined {
  return CRM_PROVIDERS[crmType]
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Push an existing internal Contact to the client's connected external CRM.
 * Looks up the contact in Postgres, finds the right provider, mirrors it,
 * and stores the external ID in `Contact.crmId`. Failures are logged but
 * never thrown — the internal CRM is the source of truth.
 */
export async function syncExistingContactToCrm(clientId: string, contactId: string): Promise<string | undefined> {
  try {
    const crmType = await getClientCrmType(clientId)
    const provider = getProvider(crmType)
    if (!provider) return undefined // 'internal' or unknown — nothing to mirror

    const existing = await prisma.$queryRaw<Array<{ name: string | null; email: string | null; phone: string | null; source: string | null; crmId: string | null }>>`
      SELECT "name", "email", "phone", "source", "crmId"
      FROM "Contact" WHERE "id" = ${contactId} AND "clientId" = ${clientId}
    `
    const row = existing[0]
    if (!row) return undefined
    if (row.crmId) return row.crmId // already synced

    const crmId = await provider.createContact(clientId, {
      name: row.name || '',
      email: row.email || '',
      phone: row.phone || '',
      source: row.source || ''
    })
    await prisma.$executeRaw`UPDATE "Contact" SET "crmId" = ${crmId} WHERE "id" = ${contactId}`
    logger.info('External CRM sync complete', { clientId, contactId, crmId, crmType })
    return crmId
  } catch (err) {
    logger.warn('External CRM sync failed — contact still saved internally', { clientId, contactId, err: String(err) })
    return undefined
  }
}

/**
 * Push a lead-score / status update to the client's connected external CRM.
 * Best-effort — failures are logged, never thrown.
 */
export async function syncContactScoreToCrm(clientId: string, contactId: string, score: number): Promise<void> {
  try {
    const crmType = await getClientCrmType(clientId)
    const provider = getProvider(crmType)
    if (!provider?.updateLeadStatus) return

    const rows = await prisma.$queryRaw<Array<{ crmId: string | null }>>`
      SELECT "crmId" FROM "Contact" WHERE "id" = ${contactId} AND "clientId" = ${clientId}
    `
    const crmId = rows[0]?.crmId
    if (!crmId) return

    await provider.updateLeadStatus(clientId, crmId, score)
    logger.info('External CRM score synced', { clientId, contactId, score, crmType })
  } catch (err) {
    logger.warn('External CRM score sync failed', { clientId, contactId, err: String(err) })
  }
}

/**
 * Attach a free-text note (call summary, transcript, AI activity) to the
 * connected external CRM contact. Best-effort.
 */
export async function addCallNoteToCrm(clientId: string, contactId: string, body: string): Promise<void> {
  try {
    const crmType = await getClientCrmType(clientId)
    const provider = getProvider(crmType)
    if (!provider?.addNote) return

    const rows = await prisma.$queryRaw<Array<{ crmId: string | null }>>`
      SELECT "crmId" FROM "Contact" WHERE "id" = ${contactId} AND "clientId" = ${clientId}
    `
    const crmId = rows[0]?.crmId
    if (!crmId) return

    await provider.addNote(clientId, crmId, body)
    logger.info('External CRM note added', { clientId, contactId, crmType })
  } catch (err) {
    logger.warn('External CRM note failed', { clientId, contactId, err: String(err) })
  }
}

/**
 * Save a lead to the internal CRM and (if connected) mirror it to the
 * client's external CRM. This is the ONE function every lead-arrival path
 * should use. Internal save is required; external sync is best-effort.
 */
export async function upsertContactAndSync(
  clientId: string,
  data: ContactInput & { tags?: string[]; pipelineStage?: string }
): Promise<{ id: string; isNew: boolean; crmId?: string }> {
  const newId = randomUUID()
  const tagsJson = JSON.stringify(Array.isArray(data.tags) ? data.tags : [])
  const stage = data.pipelineStage || 'NEW_LEAD'

  // 1. Always write to internal Postgres first — source of truth
  const rows = await prisma.$queryRaw<Array<{ id: string; is_new: boolean }>>`
    INSERT INTO "Contact" ("id", "clientId", "name", "email", "phone", "source", "tags", "stage", "pipelineStage", "updatedAt")
    VALUES (${newId}, ${clientId}, ${data.name || null}, ${data.email || null}, ${data.phone || null},
            ${data.source || null}, ${tagsJson}::jsonb, 'new', ${stage}, NOW())
    ON CONFLICT ("clientId", "email") WHERE "email" IS NOT NULL
    DO UPDATE SET
      "name"      = COALESCE(EXCLUDED."name", "Contact"."name"),
      "phone"     = COALESCE(EXCLUDED."phone", "Contact"."phone"),
      "updatedAt" = NOW()
    RETURNING "id", (xmax = 0) AS is_new
  `
  const id = rows[0]?.id || newId
  const isNew = rows[0]?.is_new !== false

  // 2. Best-effort mirror to whichever external CRM is connected
  const crmId = await syncExistingContactToCrm(clientId, id)

  return { id, isNew, crmId }
}
