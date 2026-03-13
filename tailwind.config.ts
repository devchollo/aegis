import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config = {
  darkMode: ["class"],
  content: ["./popup.html", "./options.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))"
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))"
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))"
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))"
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))"
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))"
        }
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)"
      },
      fontFamily: {
        sans: ["Bahnschrift", "\"Segoe UI Variable Text\"", "\"Segoe UI\"", "system-ui", "sans-serif"],
        display: ["\"Palatino Linotype\"", "\"Book Antiqua\"", "Georgia", "serif"]
      },
      boxShadow: {
        glow: "0 18px 40px rgba(15, 23, 42, 0.18)"
      },
      backgroundImage: {
        "vault-grid":
          "radial-gradient(circle at top, rgba(15, 118, 110, 0.16), transparent 28%), linear-gradient(rgba(148, 163, 184, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px)"
      },
      backgroundSize: {
        "vault-grid": "auto, 32px 32px, 32px 32px"
      }
    }
  },
  plugins: [animate]
} satisfies Config;

export default config;
