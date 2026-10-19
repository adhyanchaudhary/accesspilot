/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep blue used for text and dark surfaces (was "navy").
        navy: {
          50: '#f0f5ff',
          100: '#dce8fb',
          200: '#c1d6f5',
          300: '#94b4e8',
          400: '#648ed6',
          500: '#3f6cbf',
          600: '#2b529b',
          700: '#22417b',
          800: '#1a3162',
          900: '#12234a',
          950: '#0b1b3a',
        },
        // Vivid accent blue from the design reference.
        brand: {
          50: '#eef4ff',
          100: '#e7f0ff',
          200: '#cfe0ff',
          300: '#a7c8ff',
          400: '#7aa8ff',
          500: '#4a86ff',
          600: '#2b6bf3',
          700: '#1e57d8',
          800: '#1c47ad',
          900: '#1c3f8a',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        display: ['"Space Grotesk"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: [
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      boxShadow: {
        card: '0 1px 2px rgba(13, 24, 38, 0.06), 0 12px 32px -12px rgba(13, 24, 38, 0.18)',
        glow: '0 0 0 1px rgba(43, 107, 243, 0.12), 0 24px 60px -30px rgba(16, 43, 90, 0.55)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
        beam: {
          '0%, 100%': { transform: 'translateX(-120%)' },
          '50%': { transform: 'translateX(120%)' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.35', transform: 'scale(0.65)' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
        'gradient-x': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out both',
        shimmer: 'shimmer 1.4s linear infinite',
        beam: 'beam 6.5s ease-in-out infinite',
        'pulse-dot': 'pulse-dot 1.8s ease-in-out infinite',
        'spin-slow': 'spin-slow 2.6s linear infinite',
        'gradient-x': 'gradient-x 6s ease infinite',
      },
    },
  },
  plugins: [],
}
