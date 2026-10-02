import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0a0f",
          900: "#12121a",
          850: "#171722",
          800: "#1d1d2b",
          700: "#2a2a3d",
          600: "#3a3a52",
        },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.22s ease-out",
        "pulse-soft": "pulseSoft 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
