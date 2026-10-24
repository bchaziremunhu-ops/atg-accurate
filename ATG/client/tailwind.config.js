export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#FFFFFF',
          100: '#F7F8FA',
          200: '#ECEEF2',
          300: '#D9DEE7',
        },
        gold: {
          50: '#FFF8EF',
          100: '#FCEAD4',
          200: '#F7D4A8',
          300: '#EFB46F',
          400: '#E9943E',
          500: '#D97716',
          600: '#BF5E0A',
          700: '#98450D',
          800: '#71340F',
          900: '#4C270F',
        },
        ink: {
          DEFAULT: '#17191D',
          soft: '#343941',
          muted: '#68707B',
          faint: '#929AA5',
        },
        success: '#16A34A',
        danger: '#DC2626',
      },
      fontFamily: {
        sans: ['Poppins', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
      boxShadow: {
        card: '0 2px 12px -4px rgba(23, 25, 29, 0.12)',
        gold: '0 4px 12px -5px rgba(152, 69, 13, 0.28)',
      },
      backgroundImage: {
        'gold-gradient': 'linear-gradient(135deg,#A84F0C 0%,#98450D 100%)',
        'gold-soft': 'linear-gradient(135deg,#FFF8EF 0%,#FCEAD4 100%)',
      },
    },
  },
  plugins: [],
};
