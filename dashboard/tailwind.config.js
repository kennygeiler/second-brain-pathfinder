/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        pathfinder: {
          bg: "#0b0f17",
          surface: "#111827",
          accent: "#38bdf8",
          warn: "#f97316",
          danger: "#ef4444",
        },
      },
    },
  },
  plugins: [],
};
