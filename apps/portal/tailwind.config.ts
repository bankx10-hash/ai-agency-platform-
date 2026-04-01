import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        base:    '#07080d',
        surface: '#0d0e16',
        raised:  '#12141f',
        accent:  '#6366f1',
        gold:    '#f59e0b',
        primary: {
          50:  '#f0f4ff',
          100: '#e0e8ff',
          500: '#6366f1',
          600: '#5558e8',
          700: '#4749cc',
          900: '#3730a3'
        }
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
        'gradient-gold':    'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)'
      },
      boxShadow: {
        'glow-sm':  '0 0 12px rgba(99,102,241,0.20)',
        'glow-md':  '0 0 24px rgba(99,102,241,0.25)',
        'glow-lg':  '0 0 48px rgba(99,102,241,0.20)',
        'card':     '0 1px 3px rgba(0,0,0,0.40), 0 0 0 1px rgba(255,255,255,0.06)',
        'card-hover': '0 4px 24px rgba(0,0,0,0.50), 0 0 0 1px rgba(255,255,255,0.10)',
      },
      borderColor: {
        subtle: 'rgba(255,255,255,0.07)',
        DEFAULT: 'rgba(255,255,255,0.10)'
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-in': 'fadeIn 0.4s ease-out'
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' }
        }
      }
    }
  },
  plugins: []
}

export default config
