import { createRouter, createWebHistory } from 'vue-router'
// 从虚拟模块导入路由配置
import { routes } from 'virtual:auto-routes'

console.log('Auto-generated routes:', routes) // 查看生成的路由

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: routes, // 直接使用导入的数组
  // strict: true, // Vue Router 自身的严格模式（可选）
})

// 在这里添加全局导航守卫
router.beforeEach((to, from, next) => {
  const pageTitle = to.meta?.title // JS 中访问 meta
  if (pageTitle) {
    document.title = pageTitle
  } else {
    document.title = 'My Vue App' // 默认标题
  }
  // 可以添加认证逻辑等...
  console.log(`Navigating from ${from.path} to ${to.path}`)
  next()
})

export default router
