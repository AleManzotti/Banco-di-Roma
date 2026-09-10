/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: { signature: ["'Great Vibes'", "cursive"] },
      colors: {
        gold: {
          50: "#FBF3D9",
          100: "#F7E7B0",
          200: "#EFD077",
          300: "#E6BB4A",
          400: "#D4A62E",
          500: "#C0921F",
          600: "#A37A19",
          700: "#816015",
          800: "#644A11",
          900: "#4A360C",
          950: "#2E2107",
        },
        navy: {
          50: "#EFF3FA",
          100: "#D6DEEE",
          200: "#B0BFDA",
          300: "#8296BC",
          400: "#5A729B",
          500: "#3A4F73",
          600: "#253651",
          700: "#182338",
          800: "#10192E",
          900: "#0A0F1F",
          950: "#060912",
        },
      },
    },
  },
  plugins: [],
};
