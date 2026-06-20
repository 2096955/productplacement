/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          red: "#DB0011",
          redDark: "#A50010",
          ink: "#1C1C1C",
          paper: "#F3F4F4",
          line: "#E2E5E6",
          muted: "#6B7578",
          field: "#FAFBFB",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
