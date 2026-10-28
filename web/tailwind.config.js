/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        // 清新主色调：薄荷绿 + 天蓝
        primary: {
          50: '#f0fdf9', 100: '#ccfbef', 200: '#99f6e0', 300: '#5eead4',
          400: '#2dd4b7', 500: '#14b8a0', 600: '#0d9488', 700: '#0f766e',
          800: '#115e59', 900: '#134e4a'
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Microsoft YaHei', 'sans-serif']
      }
    }
  },
  plugins: []
}
