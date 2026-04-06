'use client'

import { useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import axios from 'axios'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '')
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const plans = [
  {
    id: 'AI_RECEPTIONIST',
    name: 'AI Receptionist',
    price: 147,
    description: 'AI answers every call 24/7, books appointments, follows up, and reminds clients to rebook. Perfect for service businesses.',
    agents: [
      'AI Receptionist (24/7 inbound)',
      'Automated Follow-Up Calls',
      'Recurring Rebooking Reminders',
      '2 Phone Numbers Included',
      'CRM with Service Pipeline'
    ],
    color: 'from-emerald-500 to-teal-500',
    priceId: process.env.NEXT_PUBLIC_STRIPE_RECEPTIONIST_PRICE_ID || 'price_receptionist'
  },
  {
    id: 'STARTER',
    name: 'Starter',
    price: 197,
    description: 'AI lead scoring, appointment setting, and inbound voice — your first AI sales team.',
    agents: [
      'Lead Generation Agent',
      'Appointment Setter Agent',
      'Voice Inbound Agent (24/7)',
      'Social Engagement Agent',
      'Conversational Workflows'
    ],
    color: 'from-blue-500 to-cyan-500',
    priceId: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID || 'price_starter'
  },
  {
    id: 'GROWTH',
    name: 'Growth',
    price: 497,
    description: 'Proactive outreach across LinkedIn, social media, and outbound calling.',
    agents: [
      'Everything in Starter',
      'LinkedIn Outreach Agent',
      'Social Media Agent',
      'Voice Outbound Agent',
      'Content Calendar & Analytics'
    ],
    color: 'from-indigo-500 to-purple-600',
    highlighted: true,
    priceId: process.env.NEXT_PUBLIC_STRIPE_GROWTH_PRICE_ID || 'price_growth'
  },
  {
    id: 'AGENCY',
    name: 'Agency',
    price: 997,
    description: 'The complete AI-powered sales machine. From first touch to closed deal.',
    agents: [
      'Everything in Growth',
      'Voice Closer Agent',
      'Advertising Manager (Meta/Google)',
      'Client Services Agent',
      'Priority Support'
    ],
    color: 'from-purple-600 to-pink-600',
    priceId: process.env.NEXT_PUBLIC_STRIPE_AGENCY_PRICE_ID || 'price_agency'
  }
]

export default function OnboardingPage() {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSelectPlan(planId: string, priceId: string) {
    setSelectedPlan(planId)
    setLoading(true)
    setError('')

    try {
      const clientId = localStorage.getItem('clientId')
      const token = localStorage.getItem('token')

      if (!clientId || !token) {
        window.location.href = '/login'
        return
      }

      // Update client plan in DB
      await axios.patch(
        `${API_URL}/clients/${clientId}`,
        { plan: planId },
        { headers: { Authorization: `Bearer ${token}` } }
      ).catch(() => {})

      localStorage.setItem('clientPlan', planId)

      // Try Stripe checkout if configured
      try {
        const response = await axios.post(
          `${API_URL}/billing/create-checkout-session`,
          {
            priceId,
            clientId,
            successUrl: `${window.location.origin}/onboarding/connect?session_id={CHECKOUT_SESSION_ID}&clientId=${clientId}`,
            cancelUrl: `${window.location.origin}/onboarding`
          },
          { headers: { Authorization: `Bearer ${token}` } }
        )

        const stripe = await stripePromise
        if (stripe && response.data.sessionId) {
          await stripe.redirectToCheckout({ sessionId: response.data.sessionId })
          return
        }
      } catch {
        // Stripe not configured — skip payment (testing mode)
      }

      // Fallback: go directly to connect (testing mode / no Stripe)
      window.location.href = `/onboarding/connect?clientId=${clientId}`
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.error || 'Failed to start checkout')
      } else {
        setError('An error occurred. Please try again.')
      }
      setSelectedPlan(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="flex justify-center mb-6">
            <img src="/nodus-logo.jpeg" alt="Nodus AI Systems" className="h-12 w-auto object-contain" />
          </div>
          <div className="inline-flex items-center gap-2 bg-indigo-100 text-indigo-700 px-4 py-1.5 rounded-full text-sm font-medium mb-4">
            <span>Step 1 of 3</span>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Choose your AI workforce plan</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Select the plan that matches your growth goals. All plans include automated setup — your agents will be live within minutes of payment.
          </p>
        </div>

        {error && (
          <div className="max-w-md mx-auto mb-8 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-600 text-center">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map(plan => (
            <div
              key={plan.id}
              className={`relative bg-white rounded-2xl shadow-lg overflow-hidden transition-transform hover:-translate-y-1 ${
                plan.highlighted ? 'ring-2 ring-indigo-500' : ''
              }`}
            >
              {plan.highlighted && (
                <div className="absolute top-0 left-0 right-0 bg-indigo-500 text-white text-xs font-semibold text-center py-1.5 tracking-wide uppercase">
                  Most Popular
                </div>
              )}

              <div className={`bg-gradient-to-br ${plan.color} p-6 ${plan.highlighted ? 'pt-10' : ''}`}>
                <h2 className="text-2xl font-bold text-white">{plan.name}</h2>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-4xl font-black text-white">${plan.price}</span>
                  <span className="text-white/80">/month</span>
                </div>
              </div>

              <div className="p-6">
                <p className="text-gray-600 text-sm mb-6">{plan.description}</p>

                <div className="space-y-3 mb-8">
                  {plan.agents.map(agent => (
                    <div key={agent} className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-5 h-5 bg-green-100 rounded-full flex items-center justify-center mt-0.5">
                        <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <span className="text-sm text-gray-700">{agent}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => handleSelectPlan(plan.id, plan.priceId)}
                  disabled={loading}
                  className={`w-full py-3 px-4 bg-gradient-to-r ${plan.color} text-white font-semibold rounded-xl hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md`}
                >
                  {loading && selectedPlan === plan.id ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Redirecting to payment...
                    </span>
                  ) : `Get ${plan.name} Plan`}
                </button>
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-sm text-gray-500 mt-8">
          Secure payment powered by Stripe. Cancel anytime. Agents deploy automatically after payment.
        </p>
      </div>
    </div>
  )
}
