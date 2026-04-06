import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { encryptJSON } from '../apps/api/src/utils/encrypt'

const prisma = new PrismaClient()

async function main() {
  // Find the first client
  const client = await prisma.client.findFirst({ select: { id: true, businessName: true } })
  if (!client) { console.log('No client found'); return }

  console.log(`Client: ${client.businessName} (${client.id})`)

  const service = `twilio-phone-${client.id}`
  const phoneNumber = '+61468017985'

  // Check if already exists
  const existing = await prisma.clientCredential.findFirst({
    where: { clientId: client.id, service }
  })

  if (existing) {
    console.log('Twilio phone credential already exists, updating...')
    await prisma.clientCredential.update({
      where: { id: existing.id },
      data: { credentials: encryptJSON({ phoneNumber }) }
    })
  } else {
    console.log('Creating Twilio phone credential...')
    await prisma.clientCredential.create({
      data: {
        clientId: client.id,
        service,
        credentials: encryptJSON({ phoneNumber }),
      }
    })
  }

  console.log(`Done — Twilio number ${phoneNumber} configured for ${client.businessName}`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
