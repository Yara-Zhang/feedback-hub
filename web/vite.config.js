import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// GitHub Pages 项目页部署在 /<repo>/ 路径下，可通过 BASE_PATH 覆盖（自定义域名时设为 /）
const base = process.env.BASE_PATH || '/feedback-hub/'

export default defineConfig({
  base,
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
