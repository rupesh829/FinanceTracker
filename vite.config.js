import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// IMPORTANT: change 'finance-tracker' below to your actual GitHub repo name.
// If your repo is https://github.com/yourname/my-finances, base should be '/my-finances/'.
export default defineConfig({
  plugins: [react()],
  base: '/finance-tracker/',
})
