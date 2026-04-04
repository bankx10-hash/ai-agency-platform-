import Bull from 'bull'
import { prisma } from '../lib/prisma'
import { logger } from '../utils/logger'
import { randomUUID } from 'crypto'

// rss-parser is dynamically imported below (optional dependency)

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

export const socialNewsQueue = new Bull('social-news', REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 10,
    attempts: 2,
    backoff: { type: 'exponential', delay: 15000 }
  }
})

socialNewsQueue.process(async () => {
  // Find all clients with configured news sources
  const sourceConfigs = await prisma.clientCredential.findMany({
    where: { service: 'news-sources' }
  })

  if (sourceConfigs.length === 0) return

  logger.info(`Fetching news for ${sourceConfigs.length} clients`)

  for (const config of sourceConfigs) {
    try {
      const { rssFeeds, keywords, newsApiKey } = JSON.parse(config.credentials)
      const clientId = config.clientId

      // Fetch RSS feeds
      if (rssFeeds && Array.isArray(rssFeeds)) {
        for (const feedUrl of rssFeeds) {
          try {
            await fetchRssFeed(clientId, feedUrl)
          } catch (err) {
            logger.warn('Failed to fetch RSS feed', { clientId, feedUrl, error: err })
          }
        }
      }

      // Fetch from NewsAPI if configured
      if (newsApiKey && keywords && keywords.length > 0) {
        try {
          await fetchNewsApi(clientId, newsApiKey, keywords)
        } catch (err) {
          logger.warn('Failed to fetch NewsAPI', { clientId, error: err })
        }
      }

      // Prune old items (older than 30 days)
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      await prisma.newsItem.deleteMany({
        where: { clientId, fetchedAt: { lt: cutoff }, isSaved: false }
      })
    } catch (err) {
      logger.error('Failed to process news for client', { clientId: config.clientId, error: err })
    }
  }
})

async function fetchRssFeed(clientId: string, feedUrl: string): Promise<void> {
  // Dynamic import for rss-parser (optional dependency)
  let parser: { parseURL: (url: string) => Promise<{ title?: string; items?: Array<{ title?: string; link?: string; contentSnippet?: string; content?: string; pubDate?: string; enclosure?: { url?: string } }> }> }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Parser = require('rss-parser')
    parser = new Parser({ timeout: 10000 })
  } catch {
    logger.warn('rss-parser not installed, skipping RSS fetch')
    return
  }
  const feed = await parser.parseURL(feedUrl)
  const sourceName = feed.title || new URL(feedUrl).hostname

  for (const item of (feed.items || []).slice(0, 20)) {
    if (!item.link) continue

    try {
      await prisma.newsItem.upsert({
        where: {
          clientId_url: { clientId, url: item.link }
        },
        create: {
          id: randomUUID(),
          clientId,
          title: item.title || 'Untitled',
          source: sourceName,
          url: item.link,
          imageUrl: item.enclosure?.url || null,
          summary: (item.contentSnippet || item.content || '').substring(0, 500),
          category: 'industry',
          publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
          fetchedAt: new Date()
        },
        update: {} // Don't update existing items
      })
    } catch {
      // Duplicate or constraint error — skip
    }
  }

  logger.info('RSS feed fetched', { clientId, feedUrl, items: feed.items?.length || 0 })
}

async function fetchNewsApi(clientId: string, apiKey: string, keywords: string[]): Promise<void> {
  const query = keywords.join(' OR ')
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=20&apiKey=${apiKey}`

  const response = await fetch(url)
  if (!response.ok) {
    logger.warn('NewsAPI request failed', { status: response.status })
    return
  }

  const data = await response.json() as { articles?: Array<{ title: string; url: string; urlToImage?: string; description?: string; source?: { name: string }; publishedAt?: string }> }
  const articles = data.articles || []

  for (const article of articles) {
    if (!article.url) continue

    try {
      await prisma.newsItem.upsert({
        where: {
          clientId_url: { clientId, url: article.url }
        },
        create: {
          id: randomUUID(),
          clientId,
          title: article.title || 'Untitled',
          source: article.source?.name || 'NewsAPI',
          url: article.url,
          imageUrl: article.urlToImage || null,
          summary: (article.description || '').substring(0, 500),
          category: 'trending',
          publishedAt: article.publishedAt ? new Date(article.publishedAt) : new Date(),
          fetchedAt: new Date()
        },
        update: {}
      })
    } catch {
      // Duplicate — skip
    }
  }

  logger.info('NewsAPI fetched', { clientId, articles: articles.length })
}

// Schedule recurring fetch every 6 hours
export function startSocialNewsScheduler(): void {
  socialNewsQueue.add({}, {
    repeat: { every: 6 * 60 * 60 * 1000 }
  })
  logger.info('Social news scheduler started (every 6 hours)')
}
