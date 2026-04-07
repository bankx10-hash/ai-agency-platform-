import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const clientId = 'cmnb5j2w40000n3norducvi55'
  const phoneNumber = '+61489073907'

  const service = 'closer-outbound-phone'
  const existing = await prisma.clientCredential.findFirst({
    where: { clientId, service }
  })

  const credentials = JSON.stringify({ phoneNumber })

  if (existing) {
    await prisma.clientCredential.update({
      where: { id: existing.id },
      data: { credentials }
    })
    console.log(`Updated ${service} for client ${clientId} → ${phoneNumber}`)
  } else {
    await prisma.clientCredential.create({
      data: { clientId, service, credentials }
    })
    console.log(`Created ${service} for client ${clientId} → ${phoneNumber}`)
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
