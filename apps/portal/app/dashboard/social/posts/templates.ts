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
  // ── New Templates ──────────────────────────────────────────────────
  {
    id: 'us-vs-them',
    name: 'Us vs Them',
    category: 'Ad',
    description: 'Comparison — left "Old Way" vs right "Our Way"',
    platform: 'ALL',
    objects: [
      // Dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(0,0,0,0.70)', opacity: 1 },
      // Title
      { type: 'textbox', left: 10, top: 5, width: 80, text: 'THERE\'S A BETTER WAY', fontSize: 32, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center', letterSpacing: 80 },
      // Left column (The Old Way)
      { type: 'rect', left: 4, top: 18, width: 44, height: 55, fill: 'rgba(239,68,68,0.10)', rx: 8, ry: 8, stroke: '#EF4444', strokeWidth: 1 },
      { type: 'textbox', left: 8, top: 20, width: 36, text: 'THE OLD WAY', fontSize: 18, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#EF4444', textAlign: 'center', letterSpacing: 150 },
      { type: 'textbox', left: 8, top: 28, width: 36, text: '\u2717  Manual follow-up\n\u2717  Leads go cold\n\u2717  Missed appointments\n\u2717  Burnout & overwhelm\n\u2717  Inconsistent results', fontSize: 18, fontFamily: 'Arial', fontWeight: 'normal', fill: '#F0A0A0', lineHeight: 1.8 },
      // Right column (Our Way)
      { type: 'rect', left: 52, top: 18, width: 44, height: 55, fill: 'rgba(16,185,129,0.10)', rx: 8, ry: 8, stroke: '#10B981', strokeWidth: 1 },
      { type: 'textbox', left: 56, top: 20, width: 36, text: 'OUR WAY', fontSize: 18, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#10B981', textAlign: 'center', letterSpacing: 150 },
      { type: 'textbox', left: 56, top: 28, width: 36, text: '\u2713  AI instant response\n\u2713  Every lead nurtured\n\u2713  Auto-booked calls\n\u2713  Fully hands-free\n\u2713  Predictable growth', fontSize: 18, fontFamily: 'Arial', fontWeight: 'normal', fill: '#A0F0C0', lineHeight: 1.8 },
      // CTA
      { type: 'rect', left: 25, top: 80, width: 50, height: 7, fill: '#10B981', rx: 25, ry: 25 },
      { type: 'textbox', left: 27, top: 81.5, width: 46, text: 'SWITCH TO THE SMART WAY', fontSize: 17, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      // Brand
      { type: 'textbox', left: 30, top: 92, width: 40, text: 'YOUR BRAND', fontSize: 13, fontFamily: 'Arial', fontWeight: 'normal', fill: 'rgba(255,255,255,0.4)', textAlign: 'center', letterSpacing: 200 },
    ]
  },
  {
    id: 'price-packages',
    name: 'Price/Packages',
    category: 'Ad',
    description: '3-tier pricing — Basic, Pro, Premium',
    platform: 'ALL',
    objects: [
      // Dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(5,5,25,0.80)', opacity: 1 },
      // Title
      { type: 'textbox', left: 10, top: 4, width: 80, text: 'CHOOSE YOUR PLAN', fontSize: 34, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center', letterSpacing: 80 },
      // Subtitle
      { type: 'textbox', left: 15, top: 13, width: 70, text: 'Simple pricing. No hidden fees.', fontSize: 18, fontFamily: 'Arial', fontWeight: 'normal', fill: '#8899BB', textAlign: 'center' },
      // Basic column
      { type: 'rect', left: 3, top: 22, width: 29, height: 58, fill: 'rgba(255,255,255,0.05)', rx: 8, ry: 8, stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 },
      { type: 'textbox', left: 5, top: 25, width: 25, text: 'BASIC', fontSize: 14, fontFamily: 'Arial', fontWeight: 'bold', fill: '#8899BB', textAlign: 'center', letterSpacing: 200 },
      { type: 'textbox', left: 5, top: 31, width: 25, text: '$97', fontSize: 42, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      { type: 'textbox', left: 5, top: 40, width: 25, text: '/month', fontSize: 14, fontFamily: 'Arial', fontWeight: 'normal', fill: '#6677AA', textAlign: 'center' },
      { type: 'textbox', left: 6, top: 47, width: 23, text: '\u2713 Lead Generation\n\u2713 Appointment Setting\n\u2713 Email Support', fontSize: 14, fontFamily: 'Arial', fontWeight: 'normal', fill: '#AABBCC', lineHeight: 1.8 },
      // Pro column (highlighted)
      { type: 'rect', left: 35, top: 20, width: 30, height: 62, fill: 'rgba(99,102,241,0.15)', rx: 8, ry: 8, stroke: '#6366F1', strokeWidth: 2 },
      { type: 'rect', left: 40, top: 20, width: 20, height: 4, fill: '#6366F1', rx: 2, ry: 2 },
      { type: 'textbox', left: 40, top: 20.5, width: 20, text: 'MOST POPULAR', fontSize: 10, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      { type: 'textbox', left: 37, top: 27, width: 26, text: 'PRO', fontSize: 14, fontFamily: 'Arial', fontWeight: 'bold', fill: '#A5B4FC', textAlign: 'center', letterSpacing: 200 },
      { type: 'textbox', left: 37, top: 33, width: 26, text: '$297', fontSize: 42, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      { type: 'textbox', left: 37, top: 42, width: 26, text: '/month', fontSize: 14, fontFamily: 'Arial', fontWeight: 'normal', fill: '#6677AA', textAlign: 'center' },
      { type: 'textbox', left: 38, top: 49, width: 24, text: '\u2713 Everything in Basic\n\u2713 LinkedIn Outreach\n\u2713 Social Media AI\n\u2713 Priority Support', fontSize: 14, fontFamily: 'Arial', fontWeight: 'normal', fill: '#C0CCEE', lineHeight: 1.8 },
      // Premium column
      { type: 'rect', left: 68, top: 22, width: 29, height: 58, fill: 'rgba(255,255,255,0.05)', rx: 8, ry: 8, stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 },
      { type: 'textbox', left: 70, top: 25, width: 25, text: 'PREMIUM', fontSize: 14, fontFamily: 'Arial', fontWeight: 'bold', fill: '#8899BB', textAlign: 'center', letterSpacing: 200 },
      { type: 'textbox', left: 70, top: 31, width: 25, text: '$697', fontSize: 42, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      { type: 'textbox', left: 70, top: 40, width: 25, text: '/month', fontSize: 14, fontFamily: 'Arial', fontWeight: 'normal', fill: '#6677AA', textAlign: 'center' },
      { type: 'textbox', left: 71, top: 47, width: 23, text: '\u2713 Everything in Pro\n\u2713 Voice AI Agents\n\u2713 Ad Management\n\u2713 Dedicated Manager', fontSize: 14, fontFamily: 'Arial', fontWeight: 'normal', fill: '#AABBCC', lineHeight: 1.8 },
      // CTA
      { type: 'rect', left: 30, top: 86, width: 40, height: 7, fill: '#6366F1', rx: 25, ry: 25 },
      { type: 'textbox', left: 32, top: 87.5, width: 36, text: 'GET STARTED TODAY', fontSize: 17, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
    ]
  },
  {
    id: 'client-case-study',
    name: 'Client Win',
    category: 'Social Proof',
    description: 'Case study — before/after numbers, quote, CTA',
    platform: 'ALL',
    objects: [
      // Dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(0,0,0,0.65)', opacity: 1 },
      // Label
      { type: 'rect', left: 8, top: 6, width: 22, height: 4.5, fill: '#10B981', rx: 3, ry: 3 },
      { type: 'textbox', left: 10, top: 7, width: 18, text: 'CASE STUDY', fontSize: 14, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      // Before number
      { type: 'textbox', left: 8, top: 18, width: 35, text: '12', fontSize: 90, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#EF4444' },
      { type: 'textbox', left: 8, top: 38, width: 35, text: 'LEADS/MONTH\nBEFORE', fontSize: 16, fontFamily: 'Arial', fontWeight: 'bold', fill: '#F0A0A0', lineHeight: 1.4 },
      // Arrow
      { type: 'textbox', left: 44, top: 22, width: 12, text: '\u2192', fontSize: 60, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF' },
      // After number
      { type: 'textbox', left: 57, top: 18, width: 35, text: '147', fontSize: 90, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#10B981' },
      { type: 'textbox', left: 57, top: 38, width: 35, text: 'LEADS/MONTH\nAFTER', fontSize: 16, fontFamily: 'Arial', fontWeight: 'bold', fill: '#A0F0C0', lineHeight: 1.4 },
      // Divider
      { type: 'rect', left: 8, top: 52, width: 84, height: 0.3, fill: 'rgba(255,255,255,0.15)' },
      // Quote
      { type: 'textbox', left: 8, top: 56, width: 84, text: '"We couldn\'t believe the results. AI completely transformed our pipeline in just 30 days."', fontSize: 24, fontFamily: 'Georgia', fontWeight: 'normal', fill: '#FFFFFF', textAlign: 'left', lineHeight: 1.5 },
      // Attribution
      { type: 'textbox', left: 8, top: 76, width: 50, text: '— Mike R., Roofing Company', fontSize: 16, fontFamily: 'Arial', fontWeight: 'bold', fill: '#10B981' },
      // CTA
      { type: 'rect', left: 8, top: 86, width: 40, height: 7, fill: '#10B981', rx: 25, ry: 25 },
      { type: 'textbox', left: 10, top: 87.5, width: 36, text: 'GET RESULTS LIKE THIS', fontSize: 16, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
    ]
  },
  {
    id: 'faq-post',
    name: 'FAQ',
    category: 'Organic',
    description: 'Question & answer — educational format',
    platform: 'ALL',
    objects: [
      // Dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(5,5,25,0.75)', opacity: 1 },
      // Question mark accent
      { type: 'textbox', left: 70, top: 5, width: 25, text: '?', fontSize: 160, fontFamily: 'Arial Black', fontWeight: 'bold', fill: 'rgba(99,102,241,0.15)' },
      // Label
      { type: 'textbox', left: 8, top: 10, width: 30, text: 'FAQ', fontSize: 16, fontFamily: 'Arial', fontWeight: 'bold', fill: '#6366F1', letterSpacing: 300 },
      // Accent line
      { type: 'rect', left: 8, top: 18, width: 6, height: 0.4, fill: '#6366F1' },
      // Question
      { type: 'textbox', left: 8, top: 24, width: 84, text: 'How quickly can AI start generating leads for my business?', fontSize: 38, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', lineHeight: 1.2 },
      // Divider
      { type: 'rect', left: 8, top: 55, width: 84, height: 0.3, fill: 'rgba(255,255,255,0.15)' },
      // Answer
      { type: 'textbox', left: 8, top: 60, width: 84, text: 'Most businesses see their first AI-generated leads within 48 hours of setup. Our system handles prospecting, qualification, and follow-up automatically — so you can focus on closing.', fontSize: 20, fontFamily: 'Arial', fontWeight: 'normal', fill: '#B0B8D0', lineHeight: 1.5 },
      // Brand
      { type: 'textbox', left: 8, top: 92, width: 40, text: 'YOUR BRAND', fontSize: 13, fontFamily: 'Arial', fontWeight: 'normal', fill: 'rgba(255,255,255,0.4)', letterSpacing: 200 },
    ]
  },
  {
    id: 'hiring-post',
    name: "We're Hiring",
    category: 'Organic',
    description: 'Recruitment post — role, perks, apply CTA',
    platform: 'ALL',
    objects: [
      // Dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(15,5,40,0.75)', opacity: 1 },
      // Badge
      { type: 'rect', left: 8, top: 8, width: 28, height: 5, fill: '#8B5CF6', rx: 3, ry: 3 },
      { type: 'textbox', left: 10, top: 9, width: 24, text: "WE'RE HIRING", fontSize: 15, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      // Role title
      { type: 'textbox', left: 8, top: 22, width: 84, text: 'Senior AI\nEngineer', fontSize: 56, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', lineHeight: 1.1 },
      // Perks
      { type: 'textbox', left: 8, top: 52, width: 84, text: '\u2713  Fully remote — work from anywhere\n\u2713  Competitive salary + equity\n\u2713  Unlimited PTO\n\u2713  Top-tier team & cutting-edge AI', fontSize: 20, fontFamily: 'Arial', fontWeight: 'normal', fill: '#C8B8E8', lineHeight: 1.7 },
      // CTA
      { type: 'rect', left: 8, top: 82, width: 35, height: 7, fill: '#8B5CF6', rx: 25, ry: 25 },
      { type: 'textbox', left: 10, top: 83.5, width: 31, text: 'APPLY NOW', fontSize: 18, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      // Brand
      { type: 'textbox', left: 8, top: 93, width: 40, text: 'YOUR BRAND', fontSize: 13, fontFamily: 'Arial', fontWeight: 'normal', fill: 'rgba(255,255,255,0.4)', letterSpacing: 200 },
    ]
  },
  {
    id: 'holiday-seasonal',
    name: 'Holiday/Seasonal',
    category: 'Organic',
    description: 'Festive greeting — seasonal promotions',
    platform: 'ALL',
    objects: [
      // Dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(10,0,0,0.55)', opacity: 1 },
      // Decorative accent top
      { type: 'rect', left: 0, top: 0, width: 100, height: 1, fill: '#FFD700', opacity: 0.6 },
      { type: 'rect', left: 0, top: 99, width: 100, height: 1, fill: '#FFD700', opacity: 0.6 },
      // Decorative star accents
      { type: 'textbox', left: 5, top: 8, width: 10, text: '\u2726', fontSize: 40, fontFamily: 'Arial', fill: 'rgba(255,215,0,0.3)' },
      { type: 'textbox', left: 85, top: 15, width: 10, text: '\u2726', fontSize: 30, fontFamily: 'Arial', fill: 'rgba(255,215,0,0.25)' },
      { type: 'textbox', left: 78, top: 70, width: 10, text: '\u2726', fontSize: 35, fontFamily: 'Arial', fill: 'rgba(255,215,0,0.2)' },
      // Greeting
      { type: 'textbox', left: 10, top: 25, width: 80, text: 'HAPPY\nHOLIDAYS', fontSize: 64, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center', lineHeight: 1.1, letterSpacing: 60 },
      // Sub message
      { type: 'textbox', left: 15, top: 58, width: 70, text: 'Wishing you joy, success, and growth in the new year!', fontSize: 22, fontFamily: 'Georgia', fontWeight: 'normal', fill: '#FFE4A0', textAlign: 'center', lineHeight: 1.4 },
      // Accent line
      { type: 'rect', left: 35, top: 74, width: 30, height: 0.3, fill: '#FFD700', opacity: 0.5 },
      // Brand
      { type: 'textbox', left: 15, top: 80, width: 70, text: 'FROM YOUR BRAND', fontSize: 16, fontFamily: 'Arial', fontWeight: 'bold', fill: 'rgba(255,255,255,0.5)', textAlign: 'center', letterSpacing: 250 },
    ]
  },
  {
    id: 'review-rating',
    name: '5-Star Review',
    category: 'Social Proof',
    description: 'Customer review showcase with stars',
    platform: 'ALL',
    objects: [
      // Dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(0,0,0,0.65)', opacity: 1 },
      // Stars
      { type: 'textbox', left: 10, top: 12, width: 80, text: '\u2605 \u2605 \u2605 \u2605 \u2605', fontSize: 48, fontFamily: 'Arial', fill: '#FFD700', textAlign: 'center' },
      // Quote mark
      { type: 'textbox', left: 10, top: 26, width: 15, text: '\u201C', fontSize: 80, fontFamily: 'Georgia', fontWeight: 'bold', fill: '#FFD700', opacity: 0.4 },
      // Review text
      { type: 'textbox', left: 10, top: 36, width: 80, text: 'Absolutely game-changing. We went from struggling to find clients to having a full pipeline in weeks. Best investment we ever made.', fontSize: 26, fontFamily: 'Georgia', fontWeight: 'normal', fill: '#FFFFFF', textAlign: 'center', lineHeight: 1.5 },
      // Reviewer name
      { type: 'textbox', left: 20, top: 68, width: 60, text: '— Jennifer L., Real Estate Agent', fontSize: 18, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFD700', textAlign: 'center' },
      // Divider
      { type: 'rect', left: 30, top: 78, width: 40, height: 0.3, fill: 'rgba(255,215,0,0.3)' },
      // Happy clients count
      { type: 'textbox', left: 15, top: 82, width: 70, text: 'Join 500+ happy clients', fontSize: 20, fontFamily: 'Arial', fontWeight: 'bold', fill: 'rgba(255,255,255,0.6)', textAlign: 'center' },
      // Brand
      { type: 'textbox', left: 25, top: 92, width: 50, text: 'YOUR BRAND', fontSize: 13, fontFamily: 'Arial', fontWeight: 'normal', fill: 'rgba(255,255,255,0.35)', textAlign: 'center', letterSpacing: 200 },
    ]
  },
  {
    id: 'launch-announcement',
    name: 'Launch/New',
    category: 'Ad',
    description: 'Product launch — bold, exciting announcement',
    platform: 'ALL',
    objects: [
      // Dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(5,0,15,0.75)', opacity: 1 },
      // Accent line top
      { type: 'rect', left: 0, top: 0, width: 100, height: 0.5, fill: '#F59E0B' },
      // Label
      { type: 'rect', left: 8, top: 12, width: 28, height: 5, fill: '#F59E0B', rx: 3, ry: 3 },
      { type: 'textbox', left: 10, top: 13, width: 24, text: 'INTRODUCING', fontSize: 15, fontFamily: 'Arial', fontWeight: 'bold', fill: '#000000', textAlign: 'center' },
      // Product name
      { type: 'textbox', left: 8, top: 26, width: 84, text: 'AI VOICE\nAGENTS', fontSize: 68, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', lineHeight: 1.05, letterSpacing: 30 },
      // Key benefit
      { type: 'textbox', left: 8, top: 58, width: 70, text: 'Your AI receptionist answers calls, books appointments, and follows up — 24/7, in your brand voice.', fontSize: 22, fontFamily: 'Arial', fontWeight: 'normal', fill: '#D0C0A0', lineHeight: 1.4 },
      // CTA
      { type: 'rect', left: 8, top: 80, width: 38, height: 7, fill: '#F59E0B', rx: 25, ry: 25 },
      { type: 'textbox', left: 10, top: 81.5, width: 34, text: 'AVAILABLE NOW', fontSize: 18, fontFamily: 'Arial', fontWeight: 'bold', fill: '#000000', textAlign: 'center' },
      // Brand
      { type: 'textbox', left: 8, top: 93, width: 40, text: 'YOUR BRAND', fontSize: 13, fontFamily: 'Arial', fontWeight: 'normal', fill: 'rgba(255,255,255,0.4)', letterSpacing: 200 },
    ]
  },
  {
    id: 'team-about',
    name: 'Meet the Team',
    category: 'Organic',
    description: 'About us / team — warm, human feel',
    platform: 'ALL',
    objects: [
      // Dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(0,0,0,0.60)', opacity: 1 },
      // Warm accent bar
      { type: 'rect', left: 0, top: 0, width: 100, height: 0.5, fill: '#F97316' },
      // Headline
      { type: 'textbox', left: 8, top: 12, width: 84, text: 'THE TEAM BEHIND', fontSize: 18, fontFamily: 'Arial', fontWeight: 'bold', fill: '#F97316', letterSpacing: 250 },
      { type: 'textbox', left: 8, top: 20, width: 84, text: 'YOUR BRAND', fontSize: 52, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', lineHeight: 1.1 },
      // Description
      { type: 'textbox', left: 8, top: 40, width: 84, text: 'We\'re a passionate team of engineers, designers, and strategists on a mission to help businesses grow with AI.', fontSize: 22, fontFamily: 'Arial', fontWeight: 'normal', fill: '#D0C0B0', lineHeight: 1.5 },
      // Values
      { type: 'rect', left: 8, top: 62, width: 84, height: 0.3, fill: 'rgba(255,255,255,0.15)' },
      { type: 'textbox', left: 8, top: 66, width: 84, text: 'OUR VALUES', fontSize: 14, fontFamily: 'Arial', fontWeight: 'bold', fill: '#F97316', letterSpacing: 200 },
      { type: 'textbox', left: 8, top: 72, width: 84, text: 'Innovation  \u00B7  Transparency  \u00B7  Results  \u00B7  Partnership', fontSize: 20, fontFamily: 'Arial', fontWeight: 'normal', fill: '#FFFFFF', textAlign: 'left' },
      // CTA
      { type: 'textbox', left: 8, top: 88, width: 50, text: 'Learn more at yourbrand.com', fontSize: 16, fontFamily: 'Arial', fontWeight: 'normal', fill: 'rgba(255,255,255,0.5)' },
    ]
  },
  {
    id: 'tip-of-day',
    name: 'Tip of the Day',
    category: 'Organic',
    description: 'Micro content — saveable tip format',
    platform: 'INSTAGRAM',
    objects: [
      // Dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(5,10,25,0.80)', opacity: 1 },
      // Accent line
      { type: 'rect', left: 8, top: 15, width: 6, height: 0.4, fill: '#3B82F6' },
      // Tip number
      { type: 'textbox', left: 8, top: 18, width: 40, text: 'TIP #47', fontSize: 18, fontFamily: 'Arial', fontWeight: 'bold', fill: '#3B82F6', letterSpacing: 200 },
      // Tip title
      { type: 'textbox', left: 8, top: 28, width: 84, text: 'Follow Up Within\n5 Minutes', fontSize: 52, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', lineHeight: 1.1 },
      // Tip body
      { type: 'textbox', left: 8, top: 56, width: 84, text: 'Leads contacted within 5 minutes are 21x more likely to convert. Set up automated instant responses so no lead ever waits.', fontSize: 21, fontFamily: 'Arial', fontWeight: 'normal', fill: '#8899CC', lineHeight: 1.5 },
      // Save CTA
      { type: 'rect', left: 8, top: 80, width: 40, height: 7, fill: 'rgba(59,130,246,0.2)', rx: 25, ry: 25, stroke: '#3B82F6', strokeWidth: 1 },
      { type: 'textbox', left: 10, top: 81.5, width: 36, text: '\uD83D\uDCCC  SAVE THIS TIP', fontSize: 16, fontFamily: 'Arial', fontWeight: 'bold', fill: '#3B82F6', textAlign: 'center' },
      // Brand
      { type: 'textbox', left: 8, top: 93, width: 40, text: 'YOUR BRAND', fontSize: 13, fontFamily: 'Arial', fontWeight: 'normal', fill: 'rgba(255,255,255,0.35)', letterSpacing: 200 },
    ]
  },
  {
    id: 'carousel-cover',
    name: 'Carousel Cover',
    category: 'Organic',
    description: 'Carousel first slide — hook with swipe indicator',
    platform: 'INSTAGRAM',
    objects: [
      // Dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(0,0,10,0.70)', opacity: 1 },
      // Swipe indicator
      { type: 'rect', left: 70, top: 6, width: 24, height: 5, fill: 'rgba(255,255,255,0.15)', rx: 20, ry: 20 },
      { type: 'textbox', left: 72, top: 7, width: 20, text: 'SWIPE \u2192', fontSize: 14, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      // Topic title
      { type: 'textbox', left: 8, top: 28, width: 84, text: '5 AI SECRETS\nTHAT 10X YOUR\nLEAD GEN', fontSize: 54, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', lineHeight: 1.1 },
      // Subtitle
      { type: 'textbox', left: 8, top: 68, width: 70, text: 'Most businesses are leaving money on the table. Here\'s what the top 1% do differently.', fontSize: 20, fontFamily: 'Arial', fontWeight: 'normal', fill: '#A0A8C0', lineHeight: 1.4 },
      // Accent line
      { type: 'rect', left: 8, top: 88, width: 20, height: 0.5, fill: '#6366F1' },
      // Brand
      { type: 'textbox', left: 8, top: 92, width: 40, text: 'YOUR BRAND', fontSize: 13, fontFamily: 'Arial', fontWeight: 'normal', fill: 'rgba(255,255,255,0.4)', letterSpacing: 200 },
    ]
  },
  {
    id: 'story-vertical',
    name: 'Story Format',
    category: 'Organic',
    description: 'Vertical story layout — centered text, bottom CTA',
    platform: 'INSTAGRAM',
    objects: [
      // Dark overlay
      { type: 'rect', left: 0, top: 0, width: 100, height: 100, fill: 'rgba(0,0,0,0.60)', opacity: 1 },
      // Top accent line
      { type: 'rect', left: 30, top: 15, width: 40, height: 0.4, fill: '#EC4899' },
      // Main headline (centered vertically)
      { type: 'textbox', left: 8, top: 28, width: 84, text: 'STOP CHASING\nLEADS\nMANUALLY', fontSize: 52, fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center', lineHeight: 1.15 },
      // Subtitle
      { type: 'textbox', left: 12, top: 58, width: 76, text: 'Let AI do the heavy lifting while you focus on closing deals.', fontSize: 22, fontFamily: 'Arial', fontWeight: 'normal', fill: '#E0B0D0', textAlign: 'center', lineHeight: 1.4 },
      // CTA (bottom third)
      { type: 'rect', left: 20, top: 76, width: 60, height: 7, fill: '#EC4899', rx: 30, ry: 30 },
      { type: 'textbox', left: 22, top: 77.5, width: 56, text: 'TAP TO LEARN MORE', fontSize: 18, fontFamily: 'Arial', fontWeight: 'bold', fill: '#FFFFFF', textAlign: 'center' },
      // Brand
      { type: 'textbox', left: 20, top: 90, width: 60, text: 'YOUR BRAND', fontSize: 13, fontFamily: 'Arial', fontWeight: 'normal', fill: 'rgba(255,255,255,0.4)', textAlign: 'center', letterSpacing: 200 },
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
  'us-vs-them': { bg: '#0a0a0a', accent: '#10B981' },
  'price-packages': { bg: '#050519', accent: '#6366F1' },
  'client-case-study': { bg: '#0a0a0a', accent: '#10B981' },
  'faq-post': { bg: '#050519', accent: '#6366F1' },
  'hiring-post': { bg: '#0F0528', accent: '#8B5CF6' },
  'holiday-seasonal': { bg: '#1a0a0a', accent: '#FFD700' },
  'review-rating': { bg: '#0a0a0a', accent: '#FFD700' },
  'launch-announcement': { bg: '#05000F', accent: '#F59E0B' },
  'team-about': { bg: '#1a1a1a', accent: '#F97316' },
  'tip-of-day': { bg: '#050A19', accent: '#3B82F6' },
  'carousel-cover': { bg: '#00000A', accent: '#6366F1' },
  'story-vertical': { bg: '#1a0a1a', accent: '#EC4899' },
}
