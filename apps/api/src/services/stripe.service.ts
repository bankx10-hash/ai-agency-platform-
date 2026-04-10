import Stripe from 'stripe'
import { Plan } from '../../../../packages/shared/types/client.types'
import { logger } from '../utils/logger'

export class StripeService {
  private stripe: Stripe

  constructor() {
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set')
    }

    this.stripe = new Stripe(secretKey, {
      apiVersion: '2023-10-16' as Stripe.LatestApiVersion
    })
  }

  async createCustomer(email: string, name: string): Promise<{ id: string }> {
    const customer = await this.stripe.customers.create({
      email,
      name,
      metadata: {
        platform: 'ai-agency-platform'
      }
    })

    logger.info('Stripe customer created', { customerId: customer.id, email })

    return { id: customer.id }
  }

  async createSubscription(
    customerId: string,
    priceId: string
  ): Promise<{ id: string; clientSecret?: string }> {
    const subscription = await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent']
    })

    const invoice = subscription.latest_invoice as Stripe.Invoice
    const paymentIntent = invoice?.payment_intent as Stripe.PaymentIntent

    logger.info('Stripe subscription created', { subscriptionId: subscription.id, customerId })

    return {
      id: subscription.id,
      clientSecret: paymentIntent?.client_secret || undefined
    }
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(subscriptionId)
    logger.info('Stripe subscription cancelled', { subscriptionId })
  }

  async createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
    metadata?: Record<string, string>
  ): Promise<{ url: string; sessionId: string }> {
    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: metadata || {}
    })

    return { url: session.url || '', sessionId: session.id }
  }

  async createBillingPortalSession(
    customerId: string,
    returnUrl: string
  ): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl
    })
    return { url: session.url }
  }

  constructWebhookEvent(payload: Buffer | string, sig: string): Stripe.Event {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET environment variable is not set')
    }
    return this.stripe.webhooks.constructEvent(payload, sig, webhookSecret)
  }

  getPlanFromPriceId(priceId: string): Plan {
    const starterPriceId = process.env.STRIPE_STARTER_PRICE_ID || 'price_starter'
    const growthPriceId = process.env.STRIPE_GROWTH_PRICE_ID || 'price_growth'
    const agencyPriceId = process.env.STRIPE_AGENCY_PRICE_ID || 'price_agency'

    if (priceId === starterPriceId) return Plan.STARTER
    if (priceId === growthPriceId) return Plan.GROWTH
    if (priceId === agencyPriceId) return Plan.AGENCY

    logger.warn('Unknown price ID, defaulting to STARTER', { priceId })
    return Plan.STARTER
  }

  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.retrieve(subscriptionId)
  }

  /**
   * Returns the current billing period start/end for a subscription.
   */
  async getSubscriptionPeriod(subscriptionId: string): Promise<{ periodStart: Date; periodEnd: Date } | null> {
    try {
      const sub = await this.stripe.subscriptions.retrieve(subscriptionId)
      return {
        periodStart: new Date(sub.current_period_start * 1000),
        periodEnd: new Date(sub.current_period_end * 1000)
      }
    } catch (err) {
      logger.error('Failed to get subscription period', { subscriptionId, err })
      return null
    }
  }

  /**
   * Report metered overage usage to Stripe for a specific subscription item.
   * Creates a usage record that Stripe will include in the next invoice.
   */
  async reportOverageUsage(
    subscriptionItemId: string,
    quantity: number,
    timestamp?: number
  ): Promise<void> {
    if (quantity <= 0) return
    try {
      await this.stripe.subscriptionItems.createUsageRecord(
        subscriptionItemId,
        {
          quantity: Math.ceil(quantity),
          timestamp: timestamp || Math.floor(Date.now() / 1000),
          action: 'set'
        }
      )
      logger.info('Stripe overage usage reported', { subscriptionItemId, quantity })
    } catch (err) {
      logger.error('Failed to report overage usage to Stripe', { subscriptionItemId, quantity, err })
    }
  }

  /**
   * Add metered overage price items to an existing subscription.
   * Called once when a client first subscribes — adds $0 metered items
   * that only generate charges when usage is reported.
   */
  async addOverageItems(subscriptionId: string): Promise<Record<string, string>> {
    const overagePriceIds: Record<string, string> = {
      VOICE_MINUTES: process.env.STRIPE_OVERAGE_VOICE_PRICE_ID || '',
      AI_ACTIONS: process.env.STRIPE_OVERAGE_AI_PRICE_ID || '',
      SMS: process.env.STRIPE_OVERAGE_SMS_PRICE_ID || '',
      EMAILS: process.env.STRIPE_OVERAGE_EMAIL_PRICE_ID || '',
      SOCIAL_POSTS: process.env.STRIPE_OVERAGE_SOCIAL_PRICE_ID || '',
      APOLLO_PROSPECTS: process.env.STRIPE_OVERAGE_APOLLO_PRICE_ID || ''
    }

    const itemMap: Record<string, string> = {}

    for (const [usageType, priceId] of Object.entries(overagePriceIds)) {
      if (!priceId) continue
      try {
        const item = await this.stripe.subscriptionItems.create({
          subscription: subscriptionId,
          price: priceId,
          quantity: 0
        })
        itemMap[usageType] = item.id
        logger.info('Overage subscription item added', { subscriptionId, usageType, itemId: item.id })
      } catch (err) {
        logger.warn('Failed to add overage item (may already exist)', { subscriptionId, usageType, err: String(err) })
      }
    }

    return itemMap
  }
}

export const stripeService = new StripeService()
