/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      spacing: {
        4.5: '1.125rem',
      },
      opacity: {
        12: '0.12',
        15: '0.15',
        18: '0.18',
        22: '0.22',
        55: '0.55',
        65: '0.65',
      },
      colors: {
        void: '#04050c',
        ink: '#070a16',
        navy: '#0a1024',
        panel: '#0c1226',
        neon: {
          cyan: '#2ce8ff',
          violet: '#9b6dff',
          magenta: '#ff4fd8',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glow-cyan': '0 0 32px -8px rgba(44, 232, 255, 0.45)',
        'glow-violet': '0 0 40px -10px rgba(155, 109, 255, 0.55)',
        card: '0 30px 80px -40px rgba(0, 0, 0, 0.9)',
      },
      backgroundImage: {
        'hero-radial': 'radial-gradient(ellipse at top, rgba(155,109,255,0.16), transparent 55%)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        drift: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(0, -10px, 0)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.92)', opacity: '0.7' },
          '80%, 100%': { transform: 'scale(1.35)', opacity: '0' },
        },
        'scan-line': {
          '0%': { transform: 'translateY(-30%)', opacity: '0' },
          '12%': { opacity: '0.45' },
          '88%': { opacity: '0.45' },
          '100%': { transform: 'translateY(550%)', opacity: '0' },
        },
      },
      animation: {
        shimmer: 'shimmer 2.2s linear infinite',
        drift: 'drift 7s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 2.4s cubic-bezier(0.22, 1, 0.36, 1) infinite',
        'scan-line': 'scan-line 7s linear infinite',
      },
    },
  },
  plugins: [],
}
