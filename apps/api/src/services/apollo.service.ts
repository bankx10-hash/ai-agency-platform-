import axios, { AxiosInstance } from 'axios'
import { logger } from '../utils/logger'

export interface ApolloSearchFilters {
  personTitles?: string[]
  personLocations?: string[]
  employeeRanges?: string[]
  industries?: string[]
  keywords?: string[]
  revenueRange?: { min?: number; max?: number }
  companyLocations?: string[]
}

export interface ApolloPerson {
  id: string
  firstName: string
  lastName: string
  name: string
  title: string
  email?: string
  phone?: string
  linkedinUrl?: string
  city?: string
  state?: string
  country?: string
  organization?: {
    id: string
    name: string
    website?: string
    industry?: string
    employeeCount?: number
  }
}

export interface ApolloSearchResult {
  people: ApolloPerson[]
  totalResults: number
  page: number
  perPage: number
}

class ApolloService {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.apollo.io',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    })
  }

  private getApiKey(): string {
    const key = process.env.APOLLO_API_KEY
    if (!key) throw new Error('APOLLO_API_KEY environment variable is not set')
    return key
  }

  /** Auth headers for Apollo API (key must be in header, not body) */
  private authHeaders() {
    return { 'X-Api-Key': this.getApiKey() }
  }

  /**
   * Search for people matching ICP filters.
   * Does NOT consume credits. Does NOT return emails/phones.
   * Use enrichPerson() after to get contact details.
   */
  async searchPeople(
    filters: ApolloSearchFilters,
    page = 1,
    perPage = 25
  ): Promise<ApolloSearchResult> {
    try {
      const body: Record<string, unknown> = {
        page,
        per_page: perPage
      }

      if (filters.personTitles?.length) body.person_titles = filters.personTitles
      if (filters.personLocations?.length) body.person_locations = filters.personLocations
      if (filters.employeeRanges?.length) body.organization_num_employees_ranges = filters.employeeRanges
      if (filters.industries?.length) body.organization_industry_tag_ids = filters.industries
      if (filters.keywords?.length) body.q_keywords = filters.keywords.join(' ')
      if (filters.companyLocations?.length) body.organization_locations = filters.companyLocations

      const response = await this.client.post('/api/v1/mixed_people/api_search', body, { headers: this.authHeaders() })

      const people: ApolloPerson[] = (response.data.people || []).map((p: Record<string, unknown>) => ({
        id: p.id as string,
        firstName: p.first_name as string || '',
        lastName: p.last_name as string || '',
        name: p.name as string || '',
        title: p.title as string || '',
        linkedinUrl: p.linkedin_url as string || '',
        city: p.city as string || '',
        state: p.state as string || '',
        country: p.country as string || '',
        organization: p.organization ? {
          id: (p.organization as Record<string, unknown>).id as string,
          name: (p.organization as Record<string, unknown>).name as string || '',
          website: (p.organization as Record<string, unknown>).website_url as string || '',
          industry: (p.organization as Record<string, unknown>).industry as string || '',
          employeeCount: (p.organization as Record<string, unknown>).estimated_num_employees as number || 0
        } : undefined
      }))

      logger.info('Apollo people search completed', { count: people.length, total: response.data.pagination?.total_entries || 0, page })

      return {
        people,
        totalResults: response.data.pagination?.total_entries || 0,
        page,
        perPage
      }
    } catch (error) {
      logger.error('Apollo people search failed', { error, filters })
      throw error
    }
  }

  /**
   * Enrich a person to get their email and phone number.
   * Consumes 1 credit per person.
   */
  async enrichPerson(params: {
    id?: string
    email?: string
    firstName?: string
    lastName?: string
    organizationName?: string
    linkedinUrl?: string
  }): Promise<ApolloPerson | null> {
    try {
      const body: Record<string, unknown> = {
        reveal_personal_emails: true,
        reveal_phone_number: true
      }

      if (params.id) body.id = params.id
      if (params.email) body.email = params.email
      if (params.firstName) body.first_name = params.firstName
      if (params.lastName) body.last_name = params.lastName
      if (params.organizationName) body.organization_name = params.organizationName
      if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl

      const response = await this.client.post('/api/v1/people/match', body, { headers: this.authHeaders() })
      const p = response.data.person

      if (!p) return null

      const person: ApolloPerson = {
        id: p.id,
        firstName: p.first_name || '',
        lastName: p.last_name || '',
        name: p.name || '',
        title: p.title || '',
        email: p.email || p.personal_emails?.[0] || '',
        phone: p.phone_numbers?.[0]?.sanitized_number || p.organization?.phone || '',
        linkedinUrl: p.linkedin_url || '',
        city: p.city || '',
        state: p.state || '',
        country: p.country || '',
        organization: p.organization ? {
          id: p.organization.id,
          name: p.organization.name || '',
          website: p.organization.website_url || '',
          industry: p.organization.industry || '',
          employeeCount: p.organization.estimated_num_employees || 0
        } : undefined
      }

      logger.info('Apollo person enriched', { name: person.name, hasEmail: !!person.email, hasPhone: !!person.phone })

      return person
    } catch (error) {
      logger.error('Apollo person enrichment failed', { error, params })
      return null
    }
  }

  /**
   * Bulk enrich up to 10 people at once.
   * Consumes 1 credit per person found.
   */
  async bulkEnrich(people: Array<{ firstName: string; lastName: string; organizationName?: string; linkedinUrl?: string }>): Promise<ApolloPerson[]> {
    try {
      const details = people.map(p => ({
        first_name: p.firstName,
        last_name: p.lastName,
        organization_name: p.organizationName || undefined,
        linkedin_url: p.linkedinUrl || undefined
      }))

      const response = await this.client.post('/api/v1/people/bulk_match', {
        reveal_personal_emails: true,
        reveal_phone_number: true,
        details
      }, { headers: this.authHeaders() })

      const results: ApolloPerson[] = (response.data.matches || [])
        .filter((m: Record<string, unknown>) => m)
        .map((p: Record<string, unknown>) => ({
          id: p.id as string,
          firstName: p.first_name as string || '',
          lastName: p.last_name as string || '',
          name: p.name as string || '',
          title: p.title as string || '',
          email: (p.email as string) || ((p.personal_emails as string[]) || [])[0] || '',
          phone: ((p.phone_numbers as Array<{ sanitized_number: string }>) || [])[0]?.sanitized_number || '',
          linkedinUrl: p.linkedin_url as string || '',
          city: p.city as string || '',
          state: p.state as string || '',
          country: p.country as string || ''
        }))

      logger.info('Apollo bulk enrichment completed', { requested: people.length, found: results.length })

      return results
    } catch (error) {
      logger.error('Apollo bulk enrichment failed', { error })
      return []
    }
  }

  /**
   * Search for companies matching filters.
   */
  async searchCompanies(filters: {
    keywords?: string
    locations?: string[]
    employeeRanges?: string[]
    industries?: string[]
    revenueRange?: { min?: number; max?: number }
  }, page = 1, perPage = 25): Promise<Array<{ id: string; name: string; website: string; industry: string; employeeCount: number; city: string; state: string }>> {
    try {
      const body: Record<string, unknown> = {
        page,
        per_page: perPage
      }

      if (filters.keywords) body.q_organization_keyword_tags = [filters.keywords]
      if (filters.locations?.length) body.organization_locations = filters.locations
      if (filters.employeeRanges?.length) body.organization_num_employees_ranges = filters.employeeRanges
      if (filters.industries?.length) body.organization_industry_tag_ids = filters.industries

      const response = await this.client.post('/api/v1/mixed_companies/search', body, { headers: this.authHeaders() })

      return (response.data.organizations || []).map((o: Record<string, unknown>) => ({
        id: o.id as string,
        name: o.name as string || '',
        website: o.website_url as string || '',
        industry: o.industry as string || '',
        employeeCount: o.estimated_num_employees as number || 0,
        city: o.city as string || '',
        state: o.state as string || ''
      }))
    } catch (error) {
      logger.error('Apollo company search failed', { error })
      return []
    }
  }
}

export const apolloService = new ApolloService()
