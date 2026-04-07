/**
 * One-shot fix: re-import the existing Retell outbound phone number with
 * SIP credentials so Twilio will accept the call.
 *
 * Run this AFTER:
 *   1. The Twilio trunk has a Credential List attached
 *   2. RETELL_SIP_AUTH_USERNAME / RETELL_SIP_AUTH_PASSWORD are set in env
 *   3. The API is deployed with the latest code
 *
 * Usage: npx tsx prisma/reimport-retell-outbound.ts
 */
import 'dotenv/config'
import axios from 'axios'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const RETELL_API_KEY = process.env.RETELL_API_KEY || ''
const RETELL_SIP_AUTH_USERNAME = process.env.RETELL_SIP_AUTH_USERNAME || ''
const RETELL_SIP_AUTH_PASSWORD = process.env.RETELL_SIP_AUTH_PASSWORD || ''
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const TWILIO_SIP_TRUNK_SID = process.env.TWILIO_SIP_TRUNK_SID || ''

const retellApi = axios.create({
  baseURL: 'https://api.retellai.com',
  headers: { Authorization: `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' }
})

async function main() {
  if (!RETELL_SIP_AUTH_USERNAME || !RETELL_SIP_AUTH_PASSWORD) {
    console.error('❌ RETELL_SIP_AUTH_USERNAME and RETELL_SIP_AUTH_PASSWORD must be set in env')
    process.exit(1)
  }
  if (!TWILIO_SIP_TRUNK_SID) {
    console.error('❌ TWILIO_SIP_TRUNK_SID must be set in env')
    process.exit(1)
  }

  // 1. Find the closer outbound phone credential
  const cred = await prisma.clientCredential.findFirst({
    where: { service: 'closer-outbound-phone' }
  })
  if (!cred) {
    console.error('❌ No closer-outbound-phone credential found in DB')
    process.exit(1)
  }
  const decrypted = JSON.parse(cred.credentials) as { phoneNumber: string }
  const phoneNumber = decrypted.phoneNumber
  console.log(`Found closer outbound number: ${phoneNumber}`)

  // 2. Find the closer agent's retellAgentId
  const closerDeployment = await prisma.agentDeployment.findFirst({
    where: { clientId: cred.clientId, agentType: 'VOICE_CLOSER' as never, status: 'ACTIVE' as never },
    select: { retellAgentId: true, config: true }
  })
  const retellAgentId = closerDeployment?.retellAgentId
  if (!retellAgentId) {
    console.error('❌ No active VOICE_CLOSER deployment with retellAgentId found')
    process.exit(1)
  }
  const businessName = (closerDeployment.config as Record<string, unknown> | null)?.businessName as string || 'Outbound'
  console.log(`Closer Retell agent ID: ${retellAgentId}`)

  // 3. Fetch the Twilio trunk's domain (termination URI)
  const twilio = (await import('twilio')).default(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  const trunk = await twilio.trunking.v1.trunks(TWILIO_SIP_TRUNK_SID).fetch()
  const terminationUri = trunk.domainName
  if (!terminationUri) {
    console.error('❌ Twilio trunk has no domainName')
    process.exit(1)
  }
  console.log(`Twilio trunk termination URI: ${terminationUri}`)

  // 4. Delete the existing Retell phone number record (Twilio number stays)
  console.log(`Deleting existing Retell record for ${phoneNumber}...`)
  try {
    await retellApi.delete(`/delete-phone-number/${encodeURIComponent(phoneNumber)}`)
    console.log('✅ Existing Retell phone number record deleted')
  } catch (err) {
    const e = err as { response?: { status?: number; data?: unknown } }
    console.log(`(Delete returned ${e.response?.status} — continuing)`)
  }

  // 5. Re-import with SIP credentials
  console.log('Re-importing with SIP credentials...')
  await retellApi.post('/import-phone-number', {
    phone_number: phoneNumber,
    termination_uri: terminationUri,
    sip_trunk_auth_username: RETELL_SIP_AUTH_USERNAME,
    sip_trunk_auth_password: RETELL_SIP_AUTH_PASSWORD,
    outbound_agent_id: retellAgentId,
    nickname: `${businessName} Outbound (re-imported)`
  })
  console.log(`✅ Re-imported ${phoneNumber} to Retell with SIP credentials`)
  console.log(`   linked to outbound agent ${retellAgentId}`)
  console.log(`\nNext: place a test call. Should connect this time.`)
}

main().catch((err) => {
  const e = err as { response?: { status?: number; data?: unknown }; message?: string }
  console.error('❌ Failed:', e.response?.status, e.response?.data || e.message)
  process.exit(1)
}).finally(() => prisma.$disconnect())
