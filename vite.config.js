import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'

// 1. 导入你的自动路由插件
//    (确保 './plugins/vite-plugin-auto-routes.js' 路径相对于 vite.config.js 是正确的)
import { autoRoutesPlugin } from './plugins/vite-plugin-auto-routes.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueJsx(),
    vueDevTools(),

    // 2. 在插件数组中添加自动路由插件的实例
    //    并可以传递配置选项
    autoRoutesPlugin({
      pagesDir: 'src/views', // 页面组件目录
      layoutFileName: '_layout.vue', // 布局文件名
      strict: false, // 设置是否启用严格模式 (true 或 false)
      // routeBlockLang: 'yaml'   // 如果只想解析特定 lang 的 <route> 块
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // 如果你的插件或项目中需要 node 内置模块的 polyfill，
    // 可能还需要进一步配置 resolve 或 optimizeDeps，但通常 Vite 会处理好
  },
  // 你可以继续添加其他 Vite 配置项，例如 server, build 等
  // server: {
  //   port: 3000
  // },
  // build: {
  //   // ... build options
  // }
})
