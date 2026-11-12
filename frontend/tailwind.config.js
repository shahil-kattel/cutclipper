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
        paper: {
          DEFAULT: '#f4ecd9',
          soft: '#fffaf0',
          deep: '#e8dcc5',
          shadow: '#d8c9ae',
        },
        ink: {
          DEFAULT: '#211d19',
          soft: '#6d6154',
          faint: '#746758',
        },
        tomato: {
          DEFAULT: '#b8442f',
          bright: '#c24730',
          soft: '#f5d6cc',
        },
        mustard: {
          DEFAULT: '#f2be4f',
          soft: '#fae9b9',
        },
        teal: {
          DEFAULT: '#32695b',
          soft: '#d5e5dc',
        },
        periwinkle: {
          DEFAULT: '#505ba6',
          soft: '#e0e2f5',
        },
        blush: {
          DEFAULT: '#ea9da0',
          soft: '#f7dcda',
        },
        void: '#211d19',
        navy: '#e8dcc5',
        panel: '#fffaf0',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Poppins', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        hand: ['Caveat', 'cursive'],
        label: ['"Space Grotesk"', 'ui-sans-serif', 'sans-serif'],
      },
      boxShadow: {
        'paper-sm': '2px 3px 0 #211d19',
        paper: '4px 5px 0 #211d19',
        'paper-lg': '6px 7px 0 #211d19',
        card: '4px 5px 0 #211d19',
        'glow-cyan': '2px 3px 0 #211d19',
        'glow-violet': '2px 3px 0 #211d19',
      },
      backgroundImage: {
        'hero-radial':
          'radial-gradient(ellipse at top, rgba(242,190,79,0.28), transparent 62%)',
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
