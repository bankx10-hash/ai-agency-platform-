import sharp from 'sharp'
import axios from 'axios'
import { logger } from '../utils/logger'

interface AdOverlayOptions {
  backgroundImageUrl: string
  headline: string
  primaryText?: string
  ctaText?: string
  businessName?: string
  platform: 'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN'
  style?: 'bold' | 'minimal' | 'gradient' | 'dark'
}

// Platform-specific dimensions
const DIMENSIONS: Record<string, { width: number; height: number }> = {
  INSTAGRAM: { width: 1080, height: 1080 },
  FACEBOOK: { width: 1200, height: 628 },
  LINKEDIN: { width: 1200, height: 628 },
}

// Color schemes for different styles
const STYLES = {
  bold: {
    overlayColor: 'rgba(0,0,0,0.55)',
    headlineColor: '#FFFFFF',
    textColor: '#E0E0E0',
    ctaBg: '#FF4D00',
    ctaText: '#FFFFFF',
    accentColor: '#FF4D00',
  },
  minimal: {
    overlayColor: 'rgba(0,0,0,0.40)',
    headlineColor: '#FFFFFF',
    textColor: '#D0D0D0',
    ctaBg: '#FFFFFF',
    ctaText: '#000000',
    accentColor: '#FFFFFF',
  },
  gradient: {
    overlayColor: 'linear-gradient',
    headlineColor: '#FFFFFF',
    textColor: '#E8E8E8',
    ctaBg: '#6366F1',
    ctaText: '#FFFFFF',
    accentColor: '#6366F1',
  },
  dark: {
    overlayColor: 'rgba(10,10,20,0.70)',
    headlineColor: '#FFFFFF',
    textColor: '#B0B0B0',
    ctaBg: '#3B82F6',
    ctaText: '#FFFFFF',
    accentColor: '#3B82F6',
  },
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length > maxCharsPerLine) {
      if (currentLine) lines.push(currentLine.trim())
      currentLine = word
    } else {
      currentLine = (currentLine + ' ' + word).trim()
    }
  }
  if (currentLine) lines.push(currentLine.trim())
  return lines
}

function buildOverlaySvg(options: AdOverlayOptions, width: number, height: number): string {
  const style = STYLES[options.style || 'bold']
  const isSquare = width === height
  const headlineFontSize = isSquare ? 64 : 56
  const textFontSize = isSquare ? 28 : 24
  const ctaFontSize = isSquare ? 24 : 22
  const maxChars = isSquare ? 18 : 28

  const headlineLines = wrapText(options.headline.toUpperCase(), maxChars)
  const headlineBlockHeight = headlineLines.length * (headlineFontSize + 10)

  // Calculate vertical positioning
  const contentStartY = isSquare
    ? height * 0.35
    : height * 0.25

  // Build gradient/overlay background
  let overlayRect: string
  if (options.style === 'gradient') {
    overlayRect = `
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(0,0,0,0.1)" />
          <stop offset="40%" stop-color="rgba(0,0,0,0.3)" />
          <stop offset="100%" stop-color="rgba(0,0,0,0.85)" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#grad)" />`
  } else {
    overlayRect = `<rect width="${width}" height="${height}" fill="${style.overlayColor}" />`
  }

  // Accent line above headline
  const accentY = contentStartY - 20
  const accentLine = `<rect x="${width * 0.08}" y="${accentY}" width="60" height="5" rx="2" fill="${style.accentColor}" />`

  // Headline text
  const headlineTexts = headlineLines.map((line, i) => {
    const y = contentStartY + i * (headlineFontSize + 10)
    return `<text x="${width * 0.08}" y="${y}" font-family="Arial Black, Impact, Helvetica, sans-serif" font-size="${headlineFontSize}" font-weight="900" fill="${style.headlineColor}" letter-spacing="1">${escapeXml(line)}</text>`
  }).join('\n    ')

  // Primary text below headline
  let primaryTextSvg = ''
  if (options.primaryText) {
    const primaryLines = wrapText(options.primaryText, maxChars + 10)
    primaryTextSvg = primaryLines.slice(0, 3).map((line, i) => {
      const y = contentStartY + headlineBlockHeight + 30 + i * (textFontSize + 8)
      return `<text x="${width * 0.08}" y="${y}" font-family="Helvetica Neue, Arial, sans-serif" font-size="${textFontSize}" font-weight="400" fill="${style.textColor}">${escapeXml(line)}</text>`
    }).join('\n    ')
  }

  // CTA button
  let ctaSvg = ''
  if (options.ctaText) {
    const ctaY = options.primaryText
      ? contentStartY + headlineBlockHeight + 30 + 3 * (textFontSize + 8) + 30
      : contentStartY + headlineBlockHeight + 50
    const ctaWidth = Math.max(options.ctaText.length * (ctaFontSize * 0.55), 160)
    const ctaHeight = ctaFontSize + 28
    ctaSvg = `
    <rect x="${width * 0.08}" y="${ctaY}" width="${ctaWidth}" height="${ctaHeight}" rx="${ctaHeight / 2}" fill="${style.ctaBg}" />
    <text x="${width * 0.08 + ctaWidth / 2}" y="${ctaY + ctaHeight / 2 + ctaFontSize * 0.35}" font-family="Helvetica Neue, Arial, sans-serif" font-size="${ctaFontSize}" font-weight="700" fill="${style.ctaText}" text-anchor="middle" letter-spacing="1">${escapeXml(options.ctaText.toUpperCase())}</text>`
  }

  // Business name (bottom)
  let businessSvg = ''
  if (options.businessName) {
    businessSvg = `<text x="${width * 0.08}" y="${height - 40}" font-family="Helvetica Neue, Arial, sans-serif" font-size="18" font-weight="600" fill="rgba(255,255,255,0.6)" letter-spacing="2">${escapeXml(options.businessName.toUpperCase())}</text>`
  }

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${overlayRect}
    ${accentLine}
    ${headlineTexts}
    ${primaryTextSvg}
    ${ctaSvg}
    ${businessSvg}
  </svg>`
}

export async function generateAdImage(options: AdOverlayOptions): Promise<Buffer> {
  const dims = DIMENSIONS[options.platform] || DIMENSIONS.FACEBOOK

  // Download background image
  const response = await axios.get(options.backgroundImageUrl, { responseType: 'arraybuffer', timeout: 30000 })
  const bgBuffer = Buffer.from(response.data)

  // Resize background to target dimensions
  const background = await sharp(bgBuffer)
    .resize(dims.width, dims.height, { fit: 'cover', position: 'centre' })
    .toBuffer()

  // Build SVG overlay
  const svgOverlay = buildOverlaySvg(options, dims.width, dims.height)
  const svgBuffer = Buffer.from(svgOverlay)

  // Composite overlay on background
  const result = await sharp(background)
    .composite([{ input: svgBuffer, top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer()

  logger.info('Ad image generated', { platform: options.platform, style: options.style, size: result.length })
  return result
}

// Map CTA types to display text
export function ctaToDisplayText(ctaType: string): string {
  const map: Record<string, string> = {
    LEARN_MORE: 'Learn More',
    SIGN_UP: 'Sign Up Now',
    BOOK_NOW: 'Book Now',
    CONTACT_US: 'Contact Us',
    GET_OFFER: 'Get Offer',
    SHOP_NOW: 'Shop Now',
  }
  return map[ctaType] || ctaType
}
