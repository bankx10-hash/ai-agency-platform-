// Pre-defined ad template configurations for the image editor
// Each template defines fabric.js-compatible objects with positions, styles, and placeholder text

export interface TemplateObject {
  type: 'rect' | 'textbox' | 'circle'
  left: number    // percentage of canvas width (0-100)
  top: number     // percentage of canvas height (0-100)
  width?: number  // percentage of canvas width
  height?: number // percentage of canvas height
  text?: string
  fontSize?: number
  fontFamily?: string
  fontWeight?: string
  fill?: string
  stroke?: string
  strokeWidth?: number
  opacity?: number
  textAlign?: string
  rx?: number     // border radius for rect
  ry?: number
  radius?: number // for circles
  letterSpacing?: number
  lineHeight?: number
  charSpacing?: number
}

export interface Template {
  id: string
  name: string
  category: string
  description: string
  platform: 'INSTAGRAM' | 'FACEBOOK' | 'ALL'
  objects: TemplateObject[]
}

export const TEMPLATES: Template[] = [
  {
    id: 'bold-cta',
    name: 'Bold CTA',
    category: 'Ad',
    description: 'Dark overlay, large headline, CTA button',
    platform: 'ALL',
    objects: [
      // Dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(0,0,0,0.55)', opacity: 1 },
      // Accent line
      { type: 'rect', left: 8, top: 30, width: 8, height: 0.5, fill: '#FF4D00', opacity: 1 },
      // Headline
      { type: 'textbox', left: 8, top: 33, width: 84, text: 'YOUR HEADLINE HERE', fontSize: 58, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'left', letterSpacing: 50 },
      // Subtext
      { type: 'textbox', left: 8, top: 58, width: 70, text: 'Add your compelling message here. Keep it short and punchy.', fontSize: 22, fontFamily: 'Arial', fontWeight: 'normal', fill: '#D0D0D0', textAlign: 'left', lineHeight: 1.4 },
      // CTA Button background
      { type: 'rect', left: 8, top: 78, width: 30, height: 6, fill: '#FF4D00', rx: 25, ry: 25 },
      // CTA Text
      { type: 'textbox', left: 10, top: 79, width: 26, text: 'GET STARTED', fontSize: 20, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      // Business name
      { type: 'textbox', left: 8, top: 92, width: 40, text: 'YOUR BRAND', fontSize: 14, fontFamily: 'Arial', fontWeight: 'normal', fill: 'rgba(255,255,255,0.5)', letterSpacing: 200 },
    ]
  },
  {
    id: 'gradient-fade',
    name: 'Gradient Fade',
    category: 'Ad',
    description: 'Bottom gradient, text at bottom — cinematic',
    platform: 'ALL',
    objects: [
      // Gradient overlay (bottom heavy)
      { type: 'rect', left: 0, top: 50, width: 100, height: 50, fill: 'rgba(0,0,0,0.75)', opacity: 1 },
      // Headline
      { type: 'textbox', left: 6, top: 58, width: 88, text: 'MAKE IT HAPPEN', fontSize: 52, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center', letterSpacing: 80 },
      // Subtitle
      { type: 'textbox', left: 10, top: 74, width: 80, text: 'Your transformation starts today. Don\'t wait.', fontSize: 20, fontFamily: 'Arial', fontWeight: 'normal', fill: '#C0C0C0', textAlign: 'center' },
      // CTA
      { type: 'rect', left: 32, top: 85, width: 36, height: 7, fill: '#6366F1', rx: 25, ry: 25 },
      { type: 'textbox', left: 34, top: 86.5, width: 32, text: 'LEARN MORE', fontSize: 18, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
    ]
  },
  {
    id: 'minimal-corner',
    name: 'Minimal',
    category: 'Organic',
    description: 'Small text in corner, clean image focus',
    platform: 'ALL',
    objects: [
      // Subtle bottom strip
      { type: 'rect', left: 0, top: 85, width: 100, height: 15, fill: 'rgba(0,0,0,0.45)', opacity: 1 },
      // Text
      { type: 'textbox', left: 5, top: 88, width: 60, text: 'Your message here', fontSize: 24, fontFamily: 'Arial', fontWeight: 'normal', fill: '#FFFFFF', textAlign: 'left' },
      // Brand
      { type: 'textbox', left: 70, top: 89, width: 25, text: '@yourbrand', fontSize: 16, fontFamily: 'Arial', fontWeight: 'normal', fill: 'rgba(255,255,255,0.6)', textAlign: 'right' },
    ]
  },
  {
    id: 'stats-number',
    name: 'Stats/Numbers',
    category: 'Ad',
    description: 'Large number with subtitle — great for results',
    platform: 'ALL',
    objects: [
      // Dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(10,10,30,0.65)', opacity: 1 },
      // Big number
      { type: 'textbox', left: 5, top: 20, width: 90, text: '47', fontSize: 140, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FF4D00', textAlign: 'center' },
      // Unit/label
      { type: 'textbox', left: 10, top: 52, width: 80, text: 'NEW LEADS IN 24 HOURS', fontSize: 32, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center', letterSpacing: 100 },
      // Subtitle
      { type: 'textbox', left: 15, top: 65, width: 70, text: 'While you slept, AI handled your follow-up', fontSize: 20, fontFamily: 'Arial', fontWeight: 'normal', fill: '#A0A0A0', textAlign: 'center' },
      // CTA
      { type: 'rect', left: 28, top: 80, width: 44, height: 7, fill: '#FF4D00', rx: 25, ry: 25 },
      { type: 'textbox', left: 30, top: 81.5, width: 40, text: 'GET STARTED FREE', fontSize: 18, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
    ]
  },
  {
    id: 'testimonial',
    name: 'Testimonial',
    category: 'Social Proof',
    description: 'Client quote with attribution',
    platform: 'ALL',
    objects: [
      // Dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(0,0,0,0.60)', opacity: 1 },
      // Quote mark
      { type: 'textbox', left: 8, top: 18, width: 20, text: '\u201C', fontSize: 120, fontFamily: 'Georgia', fontWeight: 'bold', fill: '#6366F1', opacity: 0.6 },
      // Quote text
      { type: 'textbox', left: 10, top: 35, width: 80, text: 'This completely transformed how we handle leads. We went from losing 80% to converting 60%.', fontSize: 28, fontFamily: 'Georgia', fontWeight: 'normal', fill: '#FFFFFF', textAlign: 'left', lineHeight: 1.5 },
      // Attribution
      { type: 'textbox', left: 10, top: 72, width: 50, text: '— Sarah M., Dental Practice Owner', fontSize: 18, fontFamily: 'Arial', fontWeight: 'bold', fill: '#A0A0FF' },
      // Stars
      { type: 'textbox', left: 10, top: 80, width: 20, text: '\u2605\u2605\u2605\u2605\u2605', fontSize: 24, fontFamily: 'Arial', fill: '#FFD700' },
    ]
  },
  {
    id: 'offer-promo',
    name: 'Offer/Promo',
    category: 'Ad',
    description: 'Percentage off, promo badge, urgency',
    platform: 'ALL',
    objects: [
      // Dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(0,0,0,0.50)', opacity: 1 },
      // Badge circle
      { type: 'circle', left: 50, top: 15, radius: 12, fill: '#FF4D00' },
      { type: 'textbox', left: 38, top: 10, width: 24, text: '50%\nOFF', fontSize: 32, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      // Headline
      { type: 'textbox', left: 8, top: 42, width: 84, text: 'LIMITED TIME OFFER', fontSize: 44, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center', letterSpacing: 80 },
      // Promo details
      { type: 'textbox', left: 12, top: 60, width: 76, text: 'Use code LAUNCH50 at checkout.\nOffer expires in 48 hours.', fontSize: 22, fontFamily: 'Arial', fontWeight: 'normal', fill: '#D0D0D0', textAlign: 'center', lineHeight: 1.4 },
      // CTA
      { type: 'rect', left: 25, top: 80, width: 50, height: 8, fill: '#FF4D00', rx: 25, ry: 25 },
      { type: 'textbox', left: 27, top: 82, width: 46, text: 'CLAIM YOUR OFFER', fontSize: 20, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
    ]
  },
  {
    id: 'dark-premium',
    name: 'Dark Premium',
    category: 'Ad',
    description: 'Blue accent, premium feel, tech/SaaS style',
    platform: 'ALL',
    objects: [
      // Heavy dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(5,5,20,0.75)', opacity: 1 },
      // Blue accent bar
      { type: 'rect', left: 0, top: 0, width: 0.5, height: 100, fill: '#3B82F6' },
      // Headline
      { type: 'textbox', left: 6, top: 25, width: 88, text: 'AUTOMATE.\nSCALE.\nDOMINATE.', fontSize: 56, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'left', lineHeight: 1.2, letterSpacing: 50 },
      // Subtitle
      { type: 'textbox', left: 6, top: 65, width: 70, text: 'AI-powered automation that works 24/7 while you sleep.', fontSize: 20, fontFamily: 'Arial', fontWeight: 'normal', fill: '#8899BB', lineHeight: 1.4 },
      // CTA
      { type: 'rect', left: 6, top: 82, width: 35, height: 7, fill: '#3B82F6', rx: 4, ry: 4 },
      { type: 'textbox', left: 8, top: 83.5, width: 31, text: 'START FREE TRIAL', fontSize: 16, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
    ]
  },
  {
    id: 'split-panel',
    name: 'Split Panel',
    category: 'Ad',
    description: 'Left text panel, right image — professional',
    platform: 'FACEBOOK',
    objects: [
      // Left panel
      { type: 'rect', left: 0, top: 0, width: 45, height: 100, fill: '#0F172A', opacity: 1 },
      // Accent dot
      { type: 'circle', left: 8, top: 15, radius: 1.5, fill: '#3B82F6' },
      // Headline
      { type: 'textbox', left: 5, top: 22, width: 38, text: 'Stop Losing\nLeads Today', fontSize: 36, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', lineHeight: 1.2 },
      // Body
      { type: 'textbox', left: 5, top: 52, width: 38, text: 'Our AI follows up with every lead in under 2 minutes. 24/7. No staff needed.', fontSize: 16, fontFamily: 'Arial', fontWeight: 'normal', fill: '#94A3B8', lineHeight: 1.5 },
      // CTA
      { type: 'rect', left: 5, top: 80, width: 28, height: 7, fill: '#3B82F6', rx: 4, ry: 4 },
      { type: 'textbox', left: 7, top: 81.5, width: 24, text: 'BOOK A DEMO', fontSize: 14, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
    ]
  },
  // ── Lead Capture Templates (CTA → form) ──────────────────────────────────
  {
    id: 'lead-magnet',
    name: 'Lead Magnet',
    category: 'Lead Capture',
    description: 'Free resource offer — drives form signups',
    platform: 'ALL',
    objects: [
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(0,0,0,0.60)', opacity: 1 },
      { type: 'textbox', left: 8, top: 8, width: 30, text: 'FREE', fontSize: 18, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FF4D00', letterSpacing: 300 },
      { type: 'textbox', left: 8, top: 22, width: 84, text: 'THE ULTIMATE GUIDE\nTO AI AUTOMATION', fontSize: 48, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', lineHeight: 1.15, letterSpacing: 30 },
      { type: 'textbox', left: 8, top: 52, width: 70, text: 'Download our free guide and learn how businesses are generating 3x more leads with AI agents.', fontSize: 20, fontFamily: 'Arial', fontWeight: 'normal', fill: '#C0C0C0', lineHeight: 1.4 },
      { type: 'rect', left: 8, top: 75, width: 45, height: 8, fill: '#FF4D00', rx: 30, ry: 30 },
      { type: 'textbox', left: 10, top: 77, width: 41, text: 'DOWNLOAD FREE GUIDE', fontSize: 18, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      { type: 'textbox', left: 8, top: 88, width: 60, text: 'No credit card required • Instant access', fontSize: 14, fontFamily: 'Arial', fontWeight: 'normal', fill: 'rgba(255,255,255,0.5)' },
    ]
  },
  {
    id: 'book-call',
    name: 'Book a Call',
    category: 'Lead Capture',
    description: 'Calendar booking CTA — appointment setter',
    platform: 'ALL',
    objects: [
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(5,5,25,0.70)', opacity: 1 },
      { type: 'rect', left: 6, top: 25, width: 12, height: 0.4, fill: '#10B981' },
      { type: 'textbox', left: 6, top: 30, width: 88, text: 'BOOK YOUR FREE\nSTRATEGY CALL', fontSize: 52, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', lineHeight: 1.15 },
      { type: 'textbox', left: 6, top: 58, width: 65, text: "In 15 minutes, we'll show you exactly how AI can automate your lead follow-up and book appointments 24/7.", fontSize: 20, fontFamily: 'Arial', fontWeight: 'normal', fill: '#A0B0A0', lineHeight: 1.4 },
      { type: 'rect', left: 6, top: 78, width: 40, height: 8, fill: '#10B981', rx: 6, ry: 6 },
      { type: 'textbox', left: 8, top: 80, width: 36, text: 'BOOK NOW — FREE', fontSize: 18, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      { type: 'textbox', left: 52, top: 80, width: 40, text: 'Only 5 spots left this week', fontSize: 16, fontFamily: 'Arial', fontWeight: 'normal', fill: '#FF6B6B' },
    ]
  },
  {
    id: 'quiz-funnel',
    name: 'Quiz/Assessment',
    category: 'Lead Capture',
    description: 'Interactive quiz CTA — high conversion',
    platform: 'INSTAGRAM',
    objects: [
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(15,10,40,0.70)', opacity: 1 },
      { type: 'textbox', left: 10, top: 15, width: 80, text: 'IS YOUR BUSINESS\nREADY FOR AI?', fontSize: 52, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center', lineHeight: 1.15 },
      { type: 'rect', left: 20, top: 48, width: 60, height: 0.3, fill: '#8B5CF6' },
      { type: 'textbox', left: 12, top: 53, width: 76, text: 'Take our 60-second assessment and get\na personalised AI automation roadmap.', fontSize: 22, fontFamily: 'Arial', fontWeight: 'normal', fill: '#C0B0E0', textAlign: 'center', lineHeight: 1.4 },
      { type: 'rect', left: 22, top: 74, width: 56, height: 8, fill: '#8B5CF6', rx: 30, ry: 30 },
      { type: 'textbox', left: 24, top: 76, width: 52, text: 'TAKE THE FREE QUIZ', fontSize: 20, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      { type: 'textbox', left: 20, top: 88, width: 60, text: '2,847 businesses already assessed', fontSize: 14, fontFamily: 'Arial', fontWeight: 'normal', fill: 'rgba(255,255,255,0.4)', textAlign: 'center' },
    ]
  },
  {
    id: 'webinar-register',
    name: 'Webinar/Event',
    category: 'Lead Capture',
    description: 'Event registration CTA with date',
    platform: 'ALL',
    objects: [
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(0,0,0,0.55)', opacity: 1 },
      { type: 'rect', left: 8, top: 8, width: 25, height: 5, fill: '#EF4444', rx: 3, ry: 3 },
      { type: 'textbox', left: 10, top: 9, width: 21, text: 'LIVE EVENT', fontSize: 16, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      { type: 'textbox', left: 8, top: 22, width: 84, text: 'HOW TO 10X YOUR\nLEADS WITH AI', fontSize: 54, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', lineHeight: 1.1 },
      { type: 'textbox', left: 8, top: 52, width: 60, text: 'Free live masterclass showing the exact AI system that generated $2.4M in pipeline for our clients.', fontSize: 19, fontFamily: 'Arial', fontWeight: 'normal', fill: '#D0D0D0', lineHeight: 1.4 },
      { type: 'textbox', left: 8, top: 72, width: 50, text: 'Thursday, 7:00 PM AEST', fontSize: 20, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFD700' },
      { type: 'rect', left: 8, top: 82, width: 40, height: 7, fill: '#EF4444', rx: 25, ry: 25 },
      { type: 'textbox', left: 10, top: 83.5, width: 36, text: 'REGISTER FREE', fontSize: 18, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
    ]
  },
  {
    id: 'before-after',
    name: 'Before / After',
    category: 'Social Proof',
    description: 'Transformation results — great for case studies',
    platform: 'ALL',
    objects: [
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(0,0,0,0.65)', opacity: 1 },
      // Before side
      { type: 'rect', left: 5, top: 15, width: 42, height: 30, fill: 'rgba(239,68,68,0.15)', rx: 8, ry: 8, stroke: '#EF4444', strokeWidth: 1 },
      { type: 'textbox', left: 8, top: 17, width: 36, text: 'BEFORE', fontSize: 14, fontFamily: 'Arial', fontWeight: 'bold', fill: '#EF4444', letterSpacing: 200 },
      { type: 'textbox', left: 8, top: 24, width: 36, text: '3 leads/week\n80% lost\nManual follow-up', fontSize: 20, fontFamily: 'Arial', fontWeight: 'normal', fill: '#F0A0A0', lineHeight: 1.5 },
      // After side
      { type: 'rect', left: 53, top: 15, width: 42, height: 30, fill: 'rgba(16,185,129,0.15)', rx: 8, ry: 8, stroke: '#10B981', strokeWidth: 1 },
      { type: 'textbox', left: 56, top: 17, width: 36, text: 'AFTER', fontSize: 14, fontFamily: 'Arial', fontWeight: 'bold', fill: '#10B981', letterSpacing: 200 },
      { type: 'textbox', left: 56, top: 24, width: 36, text: '47 leads/week\n60% converted\nAI handles it all', fontSize: 20, fontFamily: 'Arial', fontWeight: 'normal', fill: '#A0F0C0', lineHeight: 1.5 },
      // Bottom CTA
      { type: 'textbox', left: 10, top: 55, width: 80, text: 'GET THESE RESULTS FOR YOUR BUSINESS', fontSize: 28, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      { type: 'rect', left: 25, top: 72, width: 50, height: 7, fill: '#10B981', rx: 25, ry: 25 },
      { type: 'textbox', left: 27, top: 73.5, width: 46, text: 'GET STARTED FREE', fontSize: 18, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
    ]
  },
  {
    id: 'countdown-urgency',
    name: 'Countdown/Urgency',
    category: 'Ad',
    description: 'Time-sensitive offer with urgency',
    platform: 'ALL',
    objects: [
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(10,0,0,0.70)', opacity: 1 },
      { type: 'textbox', left: 10, top: 12, width: 80, text: 'OFFER ENDS IN', fontSize: 18, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FF6B6B', textAlign: 'center', letterSpacing: 300 },
      // Timer boxes
      { type: 'rect', left: 15, top: 22, width: 15, height: 12, fill: 'rgba(255,68,68,0.2)', rx: 6, ry: 6, stroke: '#FF4444', strokeWidth: 1 },
      { type: 'textbox', left: 15, top: 23, width: 15, text: '02', fontSize: 40, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FF4444', textAlign: 'center' },
      { type: 'textbox', left: 15, top: 32, width: 15, text: 'DAYS', fontSize: 10, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FF8888', textAlign: 'center' },
      { type: 'rect', left: 35, top: 22, width: 15, height: 12, fill: 'rgba(255,68,68,0.2)', rx: 6, ry: 6, stroke: '#FF4444', strokeWidth: 1 },
      { type: 'textbox', left: 35, top: 23, width: 15, text: '14', fontSize: 40, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FF4444', textAlign: 'center' },
      { type: 'textbox', left: 35, top: 32, width: 15, text: 'HOURS', fontSize: 10, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FF8888', textAlign: 'center' },
      { type: 'rect', left: 55, top: 22, width: 15, height: 12, fill: 'rgba(255,68,68,0.2)', rx: 6, ry: 6, stroke: '#FF4444', strokeWidth: 1 },
      { type: 'textbox', left: 55, top: 23, width: 15, text: '37', fontSize: 40, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FF4444', textAlign: 'center' },
      { type: 'textbox', left: 55, top: 32, width: 15, text: 'MINS', fontSize: 10, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FF8888', textAlign: 'center' },
      // Offer
      { type: 'textbox', left: 8, top: 44, width: 84, text: 'FIRST MONTH FREE', fontSize: 46, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      { type: 'textbox', left: 15, top: 60, width: 70, text: 'AI lead generation + appointment setting\nfor your business. No commitment.', fontSize: 20, fontFamily: 'Arial', fontWeight: 'normal', fill: '#C0C0C0', textAlign: 'center', lineHeight: 1.4 },
      { type: 'rect', left: 22, top: 78, width: 56, height: 8, fill: '#FF4444', rx: 30, ry: 30 },
      { type: 'textbox', left: 24, top: 80, width: 52, text: 'CLAIM BEFORE IT EXPIRES', fontSize: 17, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
    ]
  },
]

// Template thumbnail colors for preview
export const TEMPLATE_COLORS: Record<string, { bg: string; accent: string }> = {
  'bold-cta': { bg: '#1a1a1a', accent: '#FF4D00' },
  'gradient-fade': { bg: '#1a1a2e', accent: '#6366F1' },
  'minimal-corner': { bg: '#333333', accent: '#FFFFFF' },
  'stats-number': { bg: '#0a0a1e', accent: '#FF4D00' },
  'testimonial': { bg: '#1a1a2e', accent: '#6366F1' },
  'offer-promo': { bg: '#1a1a1a', accent: '#FF4D00' },
  'dark-premium': { bg: '#050514', accent: '#3B82F6' },
  'split-panel': { bg: '#0F172A', accent: '#3B82F6' },
  'lead-magnet': { bg: '#1a1a1a', accent: '#FF4D00' },
  'book-call': { bg: '#051019', accent: '#10B981' },
  'quiz-funnel': { bg: '#0F0A28', accent: '#8B5CF6' },
  'webinar-register': { bg: '#1a1a1a', accent: '#EF4444' },
  'before-after': { bg: '#0a0a0a', accent: '#10B981' },
  'countdown-urgency': { bg: '#0a0000', accent: '#FF4444' },
}
