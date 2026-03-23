import Link from 'next/link'

export default function Home() {
  return (
    <div
      className="h-screen bg-[#06050f] text-white flex flex-col overflow-hidden"
      style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}
    >
      {/* subtle grid overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* radial glow */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(120,60,220,0.18) 0%, rgba(6,147,227,0.07) 50%, transparent 80%)',
        }}
      />

      {/* ── Navbar ── */}
      <header className="relative z-10 border-b border-white/[0.07]">
        <div className="max-w-5xl mx-auto px-8 h-[62px] flex items-center justify-between">
          <span className="text-sm font-black tracking-[0.12em] uppercase" style={{ color: '#1e3a5f' }}>
            Nodus AI Systems
          </span>
          <nav className="hidden md:flex items-center gap-7 text-[13px] text-gray-400">
            <Link href="/login" className="hover:text-white transition-colors duration-150">Sign in</Link>
          </nav>
          <Link
            href="/signup"
            className="px-5 py-2.5 text-[13px] font-semibold rounded-xl text-white shadow-lg transition-all duration-200 hover:opacity-90 hover:scale-[1.02]"
            style={{ background: 'linear-gradient(135deg, #0693e3 0%, #7c3aed 100%)' }}
          >
            Get started free
          </Link>
        </div>
      </header>

      {/* ── Hero ── */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6">
        {/* Live badge */}
        <div
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-semibold tracking-wide mb-8 border"
          style={{
            background: 'rgba(124,58,237,0.1)',
            borderColor: 'rgba(124,58,237,0.3)',
            color: '#c4a8f0',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full bg-[#03E78B]"
            style={{ boxShadow: '0 0 8px #03E78B' }}
          />
          250+ businesses scaling with AI · Live 24 / 7
        </div>

        {/* Headline */}
        <h1
          className="text-[52px] md:text-[72px] font-black leading-[1.02] tracking-[-0.04em] mb-5 max-w-3xl"
        >
          Your business,{' '}
          <br className="hidden md:block" />
          <span
            style={{
              background: 'linear-gradient(130deg, #60b8ff 0%, #a78bfa 45%, #e879f9 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            always&nbsp;working.
          </span>
        </h1>

        {/* Sub */}
        <p className="text-[15px] md:text-[17px] text-gray-400 mb-9 max-w-lg leading-relaxed font-light">
          NodusAI deploys intelligent agents that handle your outreach, calls,
          social content, and CRM — around the clock, without extra headcount.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center gap-3 mb-10">
          <Link
            href="/signup"
            className="w-full sm:w-auto px-9 py-3.5 text-[14px] font-bold rounded-2xl text-white shadow-2xl transition-all duration-200 hover:scale-[1.03] hover:opacity-95"
            style={{ background: 'linear-gradient(135deg, #0693e3 0%, #7c3aed 100%)' }}
          >
            Start automating →
          </Link>
          <a
            href="mailto:hello@nodusaisystems.com"
            className="w-full sm:w-auto px-9 py-3.5 text-[14px] font-medium rounded-2xl border border-white/[0.1] text-gray-300 hover:text-white hover:border-white/[0.2] hover:bg-white/[0.04] transition-all duration-200"
          >
            Talk to the team
          </a>
        </div>

        {/* Value proposition */}
        <p className="text-[13px] text-gray-500 max-w-md leading-relaxed tracking-wide">
          Automating business workflows — saving you time, saving you money, and putting you first.
        </p>
      </main>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-white/[0.06] py-4 px-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span className="text-[11px] text-gray-600">
            © {new Date().getFullYear()} NodusAI Systems Pty Ltd &nbsp;·&nbsp; ABN 63 694 785 389 &nbsp;·&nbsp; Surry Hills NSW 2010
          </span>
          <div className="flex flex-col items-end gap-1 text-[11px] text-gray-600">
            <div className="flex items-center gap-6">
              <Link href="/privacy" className="hover:text-gray-400 transition-colors">Privacy Policy</Link>
              <Link href="/terms" className="hover:text-gray-400 transition-colors">Terms</Link>
            </div>
            <a href="mailto:hello@nodusaisystems.com" className="hover:text-gray-400 transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
