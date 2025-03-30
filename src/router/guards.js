/**
 * 路由守卫和工具函数
 */

/**
 * 应用全局前置守卫
 * @param {Router} router - Vue Router 实例
 */
export function setupRouterGuards(router) {
  // 前置守卫
  router.beforeEach((to, from, next) => {
    // 可以在这里实现权限控制、登录检查等
    console.log(`导航到: ${to.path}`)

    // 示例：检查路由是否需要认证
    if (to.meta.requiresAuth && !isAuthenticated()) {
      // 重定向到登录页
      next({ path: '/login', query: { redirect: to.fullPath } })
    } else {
      next()
    }
  })

  // 后置守卫
  router.afterEach((to) => {
    // 可以在这里更新页面标题等
    document.title = to.meta.title || '默认标题'
  })

  // 错误处理
  router.onError((error) => {
    console.error('路由错误:', error)
  })
}

/**
 * 检查用户是否已认证（示例函数）
 * @returns {boolean} 认证状态
 */
function isAuthenticated() {
  // 实际项目中，这里应该检查用户的认证状态
  // 例如检查 localStorage 中的 token
  return localStorage.getItem('token') !== null
}

/**
 * 生成面包屑导航数据
 * @param {Route} route - 当前路由对象
 * @returns {Array} 面包屑数据数组
 */
export function generateBreadcrumbs(route) {
  const breadcrumbs = []

  if (route.path === '/') {
    return [{ name: '首页', path: '/' }]
  }

  // 添加首页
  breadcrumbs.push({ name: '首页', path: '/' })

  // 分割路径并生成面包屑
  const pathSegments = route.path.split('/').filter(Boolean)
  let currentPath = ''

  for (let i = 0; i < pathSegments.length; i++) {
    const segment = pathSegments[i]
    currentPath += `/${segment}`

    // 检查是否是动态参数
    if (segment.startsWith(':')) {
      // 从路由参数中获取实际值
      const paramName = segment.substring(1)
      const paramValue = route.params[paramName]
      breadcrumbs.push({
        name: paramValue || paramName,
        path: currentPath,
        dynamic: true,
      })
    } else {
      breadcrumbs.push({
        name: segment.charAt(0).toUpperCase() + segment.slice(1),
        path: currentPath,
      })
    }
  }

  return breadcrumbs
}
