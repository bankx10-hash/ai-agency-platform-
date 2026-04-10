# ============================================================
# Apollo B2B Outreach Agent — Admin Test Script
# ============================================================
# Usage: .\test-apollo-outreach.ps1
#
# This deploys the B2B_OUTREACH agent for a test client using
# the existing POST /admin/deploy-agent/:clientId endpoint.
# Customize the search filters below to match your test ICP.
# ============================================================

$API_URL = "https://api.nodusaisystems.com"
$ADMIN_SECRET = "YOUR_ADMIN_SECRET_HERE"   # Set your admin secret

# ── Target client ─────────────────────────────────────────
# Replace with your test client's ID
$CLIENT_ID = "cmnb5j2w40000n3norducvi55"

# ── Apollo search configuration ───────────────────────────
# Customize these to match the ICP you want to test against
$body = @{
    agentType = "B2B_OUTREACH"
    config = @{
        # Job titles to search for (Apollo person_titles)
        person_titles = @(
            "Owner",
            "Founder",
            "CEO",
            "Managing Director",
            "General Manager",
            "Operations Manager"
        )

        # Locations to search (Apollo person_locations)
        person_locations = @(
            "Sydney, Australia",
            "Melbourne, Australia",
            "Brisbane, Australia"
        )

        # Company size ranges (Apollo employee_ranges)
        employee_ranges = @(
            "1,10",
            "11,50",
            "51,200"
        )

        # Industries to target
        industries = @(
            "construction",
            "real estate",
            "professional services"
        )

        # Keywords to search for
        keywords = @(
            "plumbing",
            "electrical",
            "building"
        )

        # Max prospects per day
        daily_limit = 10  # Keep low for testing

        # Outreach message template (Claude will enhance this)
        outreach_message_template = "Hi {firstName}, I noticed you run {companyName} in {location}. We help businesses like yours automate lead capture and appointment booking with AI. Would you be open to a quick chat?"

        # Business details (used by Claude to generate the outreach template)
        businessName = "Nodus AI Systems"
        locationId = ""
        country = "AU"
    }
} | ConvertTo-Json -Depth 5

Write-Host "Deploying B2B_OUTREACH agent for client: $CLIENT_ID" -ForegroundColor Cyan
Write-Host "Config:" -ForegroundColor Gray
Write-Host $body -ForegroundColor DarkGray

$response = Invoke-RestMethod `
    -Uri "$API_URL/admin/deploy-agent/$CLIENT_ID" `
    -Method POST `
    -Headers @{
        "Content-Type" = "application/json"
        "x-admin-secret" = $ADMIN_SECRET
    } `
    -Body $body

Write-Host "`nResult:" -ForegroundColor Green
$response | ConvertTo-Json -Depth 5
