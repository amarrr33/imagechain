/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'gray-900': '#1a202c',
        'gray-800': '#2d3748',
        'gray-700': '#4a5568',
        'gray-600': '#718096',
        'gray-200': '#e2e8f0',
        'blue-500': '#4299e1',
        'blue-600': '#3182ce',
      }
    }
  },
  plugins: [],
}


