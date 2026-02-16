/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        vit: {
          blue: '#1e3a8a',
          dark: '#1e293b',
          light: '#f8fafc'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      },
      animation: {
        'message-in': 'messageIn 0.3s ease-out',
        'bounce-in': 'bounceIn 0.5s ease-out',
        'spin': 'spin 1s linear infinite',
      },
      keyframes: {
        messageIn: {
          'from': { opacity: '0', transform: 'translateY(20px) scale(0.95)' },
          'to': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        bounceIn: {
          '0%': { opacity: '0', transform: 'scale(0.3)' },
          '50%': { transform: 'scale(1.05)' },
          '70%': { transform: 'scale(0.9)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      }
    },
  },
  plugins: [],
}
