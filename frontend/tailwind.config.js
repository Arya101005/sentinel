/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Restrained institutional palette.
        navy: {
          50: "#eef2f7",
          100: "#d7e0ec",
          600: "#1f3a5f",
          700: "#173252",
          800: "#122742",
          900: "#0e1f36",
        },
        teal: {
          50: "#eefbf7",
          100: "#d2f5ec",
          500: "#0f9b8e",
          600: "#0c7f74",
          700: "#0a655c",
        },
        surface: "#f5f7fa",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)",
      },
    },
  },
  plugins: [],
};
