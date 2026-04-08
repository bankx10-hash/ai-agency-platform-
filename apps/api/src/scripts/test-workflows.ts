/**
 * Workflow Test Runner
 *
 * Tests all workflow JSON templates against the pre-deployment validation suite.
 * Run with: npx ts-node --transpile-only src/scripts/test-workflows.ts
 *
 * Does NOT require N8N or external APIs to be running — those checks will report
 * as warnings/failures but won't crash the script.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '..', '.env') })

import { N8NService } from '../services/n8n.service'
import { WorkflowDeployConfig } from '../../../../packages/shared/types/workflow.types'

const n8nService = new N8NService()

// Minimal realistic config covering all placeholders used across workflows
const TEST_CONFIG: WorkflowDeployConfig = {
  clientId: 'test-client-001',
  locationId: 'test-location-001',
  agentPrompt: 'You are a helpful AI assistant for Test Business Inc.',
  webhookUrl: 'https://n8n.example.com/webhook/test',
  phoneNumber: '+15551234567',
  retellAgentId: 'retell-agent-test-001',
  calendarId: 'calendar-test-001',
  pipelineId: 'pipeline-test-001',
  apiKey: 'test-api-key-001',
  businessName: 'Test Business Inc.',
  icpDescription: 'Small business owners looking to automate their sales'
}

const WORKFLOWS = [
  'lead-generation',
  'appointment-setter',
  'social-media',
  'b2b-outreach',
  'advertising',
  'voice-inbound',
  'voice-outbound',
  'voice-closer',
  'client-services',
  'onboarding-master'
]

// ANSI colours
const GREEN  = '\x1b[32m'
const RED    = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN   = '\x1b[36m'
const BOLD   = '\x1b[1m'
const RESET  = '\x1b[0m'

function pass(msg: string)  { return `${GREEN}✓${RESET} ${msg}` }
function fail(msg: string)  { return `${RED}✗${RESET} ${msg}` }
function warn(msg: string)  { return `${YELLOW}⚠${RESET} ${msg}` }
function info(msg: string)  { return `${CYAN}→${RESET} ${msg}` }

async function runTests() {
  console.log(`\n${BOLD}═══════════════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}  Workflow Pre-Deployment Test Suite${RESET}`)
  console.log(`${BOLD}═══════════════════════════════════════════════════════${RESET}\n`)

  const summary: { workflow: string; passed: boolean; errorCount: number; warningCount: number; nodeIssueCount: number }[] = []

  for (const workflowName of WORKFLOWS) {
    console.log(`${BOLD}${CYAN}── ${workflowName} ──${RESET}`)

    const result = await n8nService.testWorkflow(workflowName, TEST_CONFIG)

    // Check results
    const checks = [
      ['Template valid',              result.checks.templateValid],
      ['No unreplaced placeholders',  result.checks.noUnreplacedPlaceholders],
      ['Triggers valid',              result.checks.triggersValid],
      ['Connection graph valid',      result.checks.connectionGraphValid],
      ['Node data flow valid',        result.checks.nodeDataFlowValid],
      ['Node parameters valid',       result.checks.nodeParametersValid],
      ['N8N reachable',               result.checks.n8nReachable],
    ] as [string, boolean][]

    for (const [label, ok] of checks) {
      console.log(`  ${ok ? pass(label) : fail(label)}`)
    }

    // External API checks
    for (const [api, ok] of Object.entries(result.checks.externalApisReachable)) {
      console.log(`  ${ok ? pass(`${api} API reachable`) : warn(`${api} API not reachable (check credentials)`)}`)
    }

    // Node issues
    if (result.nodeIssues.length > 0) {
      console.log(`\n  ${BOLD}Node issues:${RESET}`)
      for (const issue of result.nodeIssues) {
        const prefix = issue.severity === 'error' ? fail(`[${issue.nodeName}]`) : warn(`[${issue.nodeName}]`)
        console.log(`    ${prefix} ${issue.issue}`)
      }
    }

    // Errors
    if (result.errors.length > 0) {
      console.log(`\n  ${BOLD}Errors:${RESET}`)
      for (const e of result.errors) {
        console.log(`    ${fail(e)}`)
      }
    }

    // Warnings
    if (result.warnings.length > 0) {
      console.log(`\n  ${BOLD}Warnings:${RESET}`)
      for (const w of result.warnings) {
        console.log(`    ${warn(w)}`)
      }
    }

    const status = result.success
      ? `${GREEN}${BOLD}PASSED${RESET}`
      : `${RED}${BOLD}FAILED${RESET}`
    console.log(`\n  Overall: ${status}\n`)

    summary.push({
      workflow: workflowName,
      passed: result.success,
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
      nodeIssueCount: result.nodeIssues.filter(i => i.severity === 'error').length
    })
  }

  // Summary table
  console.log(`${BOLD}═══════════════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}  Summary${RESET}`)
  console.log(`${BOLD}═══════════════════════════════════════════════════════${RESET}`)

  const passed = summary.filter(s => s.passed).length
  const failed = summary.filter(s => !s.passed).length

  for (const s of summary) {
    const status = s.passed ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`
    const extras = [
      s.errorCount     > 0 ? `${RED}${s.errorCount} error(s)${RESET}`       : '',
      s.nodeIssueCount > 0 ? `${RED}${s.nodeIssueCount} node error(s)${RESET}` : '',
      s.warningCount   > 0 ? `${YELLOW}${s.warningCount} warning(s)${RESET}`   : ''
    ].filter(Boolean).join(', ')
    console.log(`  ${status}  ${s.workflow.padEnd(22)} ${extras}`)
  }

  console.log(`\n  ${GREEN}${passed} passed${RESET}  ${failed > 0 ? RED : ''}${failed} failed${RESET}  of ${WORKFLOWS.length} workflows\n`)

  process.exit(failed > 0 ? 1 : 0)
}

runTests().catch(err => {
  console.error(`\n${RED}Test runner crashed:${RESET}`, err)
  process.exit(1)
})
