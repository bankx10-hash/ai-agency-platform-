import { google } from 'googleapis'
import { prisma } from '../lib/prisma'
import { decryptJSON, encryptJSON } from '../utils/encrypt'
import { logger } from '../utils/logger'

interface GoogleCredentials {
  accessToken: string
  refreshToken: string
  expiresIn?: string
}

export interface SocialPostRow {
  timestamp: string
  platform: string
  postText: string
  hashtags: string
  imageUrl: string
  imagePrompt: string
  status: 'In Progress' | 'Complete' | 'Failed'
  postId?: string
  error?: string
}

const SHEET_HEADERS = [
  'Timestamp',
  'Platform',
  'Post Text',
  'Hashtags',
  'Image URL',
  'Image Prompt',
  'Status',
  'Post ID',
  'Error'
]

async function getSheetsClient(clientId: string) {
  const cred = await prisma.clientCredential.findFirst({
    where: { clientId, service: 'google-calendar' }
  })
  if (!cred) return null

  const credentials = decryptJSON<GoogleCredentials>(cred.credentials)
  if (!credentials?.accessToken) return null

  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  )
  oauth2Client.setCredentials({
    access_token: credentials.accessToken,
    refresh_token: credentials.refreshToken
  })

  // Auto-persist refreshed tokens
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      const updated = encryptJSON({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: String(tokens.expiry_date || '')
      })
      await prisma.clientCredential.updateMany({
        where: { clientId, service: 'google-calendar' },
        data: { credentials: updated }
      })
    }
  })

  return google.sheets({ version: 'v4', auth: oauth2Client })
}

export async function createSocialMediaSheet(clientId: string): Promise<string | null> {
  try {
    const sheets = await getSheetsClient(clientId)
    if (!sheets) {
      logger.warn('No Google credentials found — skipping sheet creation', { clientId })
      return null
    }

    const response = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: 'Social Media Posts' },
        sheets: [{
          properties: { title: 'Posts', sheetId: 0 },
          data: [{
            startRow: 0,
            startColumn: 0,
            rowData: [{
              values: SHEET_HEADERS.map(header => ({
                userEnteredValue: { stringValue: header },
                userEnteredFormat: {
                  backgroundColor: { red: 0.26, green: 0.52, blue: 0.96 },
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
                }
              }))
            }]
          }]
        }]
      }
    })

    const spreadsheetId = response.data.spreadsheetId!
    logger.info('Social media Google Sheet created', { clientId, spreadsheetId })

    // Save spreadsheet ID to ClientCredential
    await prisma.clientCredential.upsert({
      where: { id: `google-sheets-social-${clientId}` },
      update: { credentials: encryptJSON({ spreadsheetId }) },
      create: {
        id: `google-sheets-social-${clientId}`,
        clientId,
        service: 'google-sheets-social',
        credentials: encryptJSON({ spreadsheetId })
      }
    })

    return spreadsheetId
  } catch (err) {
    logger.error('Failed to create social media Google Sheet', { clientId, err })
    return null
  }
}

export async function appendPostRows(clientId: string, rows: SocialPostRow[]): Promise<void> {
  try {
    const sheets = await getSheetsClient(clientId)
    if (!sheets) return

    const sheetCred = await prisma.clientCredential.findUnique({
      where: { id: `google-sheets-social-${clientId}` }
    })
    if (!sheetCred) {
      logger.warn('No social media sheet ID found for client', { clientId })
      return
    }

    const { spreadsheetId } = decryptJSON<{ spreadsheetId: string }>(sheetCred.credentials)

    const values = rows.map(row => [
      row.timestamp,
      row.platform,
      row.postText,
      row.hashtags,
      row.imageUrl,
      row.imagePrompt,
      row.status,
      row.postId || '',
      row.error || ''
    ])

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Posts!A:I',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values }
    })

    logger.info('Social post rows appended to Google Sheet', { clientId, rows: rows.length })
  } catch (err) {
    logger.error('Failed to append rows to social media sheet', { clientId, err })
  }
}
