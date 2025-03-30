import { createRouter, createWebHistory } from 'vue-router'

/**
 * 创建自动路由系统
 * @param {Object} options - 路由配置选项
 * @returns {Router} Vue Router 实例
 */
export function createAutoRouter(options = {}) {
  // 默认配置
  const config = {
    base: import.meta.env.BASE_URL,
    viewsDir: 'views',
    extendRoutes: (routes) => routes,
    ...options,
  }

  // 使用 Vite 的 import.meta.glob 扫描所有视图组件
  const pages = import.meta.glob('../views/**/*.vue')

  // 生成路由配置
  let routes = generateRoutesFromPages(pages, config)

  // 应用自定义路由扩展
  routes = config.extendRoutes(routes)

  // 添加404路由
  if (!routes.find((r) => r.path === '/:pathMatch(.*)')) {
    routes.push({
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFound.vue'),
    })
  }

  // 创建并返回路由实例
  return createRouter({
    history: createWebHistory(config.base),
    routes,
    scrollBehavior(to, from, savedPosition) {
      if (savedPosition) {
        return savedPosition
      } else {
        return { top: 0 }
      }
    },
  })
}

/**
 * 从页面文件生成路由配置
 * @param {Object} pages - 页面组件映射
 * @param {Object} config - 配置选项
 * @returns {Array} 路由配置数组
 */
function generateRoutesFromPages(pages, config) {
  const routes = []
  const routeMap = new Map()

  // 第一步：解析所有页面路径，生成基本路由信息
  Object.keys(pages).forEach((path) => {
    // 从路径中提取路由路径
    // 例如: '../views/Home.vue' -> '/home'
    let routePath = path
      .replace(`../views`, '')
      .replace(/\.vue$/, '')
      .toLowerCase()

    // 处理索引路由
    if (routePath.endsWith('/index')) {
      routePath = routePath.replace(/\/index$/, '') || '/'
    }

    // 处理动态路由参数 [param].vue -> :param
    const finalPath = routePath.replace(/\/\[([^\]]+)\]/g, '/:$1')

    // 处理捕获所有路由 [...slug].vue -> /:slug(.*)
    const catchAllPath = finalPath.replace(/\/:\.\.\.(.*?)$/, '/:$1(.*)')

    // 生成路由名称
    const segments = catchAllPath.split('/').filter(Boolean)
    const name = segments.length > 0 ? segments.join('-') : 'index'

    // 创建路由对象
    const route = {
      path: catchAllPath || '/',
      component: pages[path],
      name,
      meta: extractMetaFromPath(path),
    }

    // 将路由添加到映射中，用于后续处理嵌套路由
    routeMap.set(catchAllPath, route)
    routes.push(route)
  })

  // 第二步：处理嵌套路由
  organizeNestedRoutes(routes, routeMap)

  return routes
}

/**
 * 从路径中提取元数据
 * @param {string} path - 文件路径
 * @returns {Object} 元数据对象
 */
function extractMetaFromPath(path) {
  // 可以根据文件名或目录结构提取元数据
  // 例如：views/admin/users.vue 可以设置 meta.admin = true
  const meta = {}

  // 检查是否是动态路由
  if (path.includes('[') && path.includes(']')) {
    meta.dynamic = true
  }

  // 检查是否是布局路由
  if (path.includes('layout')) {
    meta.layout = true
  }

  return meta
}

/**
 * 组织嵌套路由
 * @param {Array} routes - 路由数组
 * @param {Map} routeMap - 路由映射
 */
function organizeNestedRoutes(routes, routeMap) {
  // 找出所有可能的父路由
  const possibleParents = [...routeMap.keys()]
    .filter((path) => path !== '/')
    .sort((a, b) => a.split('/').length - b.split('/').length)

  // 处理嵌套关系
  for (const parentPath of possibleParents) {
    const parentRoute = routeMap.get(parentPath)

    // 查找此父路由的所有子路由
    const childrenPaths = [...routeMap.keys()].filter((path) => {
      return path !== parentPath && path.startsWith(parentPath + '/')
    })

    // 如果有子路由，设置嵌套关系
    if (childrenPaths.length > 0) {
      // 创建子路由数组
      parentRoute.children = childrenPaths.map((childPath) => {
        const childRoute = routeMap.get(childPath)
        // 调整子路由路径，移除父路径部分
        childRoute.path = childRoute.path.replace(parentPath, '') || '/'
        return childRoute
      })

      // 从主路由数组中移除已成为子路由的路由
      for (const childPath of childrenPaths) {
        const index = routes.findIndex((r) => r.path === childPath)
        if (index !== -1) {
          routes.splice(index, 1)
        }
      }
    }
  }
}
