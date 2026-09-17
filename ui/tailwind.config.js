export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'IBM Plex Mono'", 'monospace'],
      },
      // /v2 draft homepage palette (Plan-it "rhodexv2full" prototype). Only
      // used under .rhodex-v2 (src/pages/v2) — no other page references
      // these names, confirmed by grep before adding.
      colors: {
        field: {
          light: '#dfe3e8',
          top: '#97a7b7',
          mid: '#b0bcc9',
          low: '#9faebe',
          deep: '#3c4653',
        },
        navy: '#2d4274',
        ink: '#1a2a41',
        accent: '#4a6fc4',
      },
      letterSpacing: { label: '0.14em' },
    },
  },
  plugins: [],
}
