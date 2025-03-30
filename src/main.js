import './assets/main.css'
import { createApp } from 'vue'
import { createAutoRouter } from './router'
import { setupRouterGuards } from './router/guards'
import { createPinia } from 'pinia'
import App from './App.vue'

// 创建应用实例
const app = createApp(App)

// 创建自动路由
const router = createAutoRouter({
  // 可选配置
  extendRoutes: (routes) => {
    // 这里可以修改或添加路由
    // 例如添加重定向
    routes.push({
      path: '/home',
      redirect: '/',
    })
    return routes
  },
})

console.log('生成的路由配置:', router.getRoutes())

// 设置路由守卫
setupRouterGuards(router)

// 使用插件
app.use(router)
app.use(createPinia())

// 挂载应用
app.mount('#app')
