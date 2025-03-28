import { defineAsyncComponent } from 'vue'
import { parse } from '@vue/compiler-sfc'
import { createRouter, createWebHistory } from 'vue-router'

// ===================== 模块导入 =====================
const pages = import.meta.glob('../views/**/*.vue')
const rawPages = import.meta.glob('../views/**/*.vue', { query: '?raw' })
const configFiles = import.meta.glob('../views/**/route.json')

// ===================== 布局组件处理 =====================
const layouts = import.meta.glob('../layouts/*.vue', { eager: true })
const layoutComponents = Object.entries(layouts).reduce((acc, [path, module]) => {
  const layoutName = path.match(/\.\.\/layouts\/(.*)\.vue$/)?.[1] || ''
  if (layoutName && module.default) {
    acc[layoutName] = module.default
  }
  return acc
}, {})

// ===================== 自定义块解析 =====================
async function parseRouteBlock(rawContent) {
  try {
    if (!rawContent) return {}
    // 使用 Vue 的 SFC 编译器解析原始内容
    // rawContent.default 处理模块的默认导出
    // parse() 返回的 descriptor 包含解析后的 SFC 描述对象
    const { descriptor } = parse(rawContent.default || rawContent)
    const routeBlock = descriptor.customBlocks?.find((b) => b.type === 'route')
    return routeBlock ? JSON.parse(routeBlock.content) : {}
  } catch (e) {
    console.error('Failed to parse route block:', e)
    return {}
  }
}

// ===================== 路由生成主逻辑 =====================
export async function generateRoutes() {
  const routes = []

  for (const pagePath of Object.keys(pages)) {
    try {
      const rawContent = await rawPages[pagePath]()
      const routeBlockConfig = await parseRouteBlock(rawContent)
      const normalizedPath = pagePath
        .replace('../views', '')
        .replace('.vue', '')
        .replace(/\/index$/, '/')
      const segments = normalizedPath.split('/').filter(Boolean)
      const fileName = segments.pop() || 'index'
      // 仅当页面文件是 index.vue 时才查找同级 route.json
      const isIndexFile = pagePath.endsWith('/index.vue')
      const configPath = isIndexFile ? pagePath.replace(/\/index\.vue$/, '/route.json') : null // 非 index 文件不查找配置文件
      let jsonConfig = {}
      if (configFiles[configPath]) {
        jsonConfig = (await configFiles[configPath]()).default || {}
      }
      const mergedMeta = {
        requiresAuth: fileName.startsWith('Auth'),
        layout: segments.includes('admin') ? 'AdminLayout' : 'DefaultLayout',
        ...jsonConfig.meta,
        ...routeBlockConfig.meta,
      }

      const route = {
        path: generateNestedPath(segments, fileName),
        component: () => pages[pagePath](),
        // 新增重定向配置支持
        redirect: jsonConfig.redirect || routeBlockConfig.redirect,
        meta: mergedMeta,
        name: jsonConfig.name || routeBlockConfig.name,
        props: jsonConfig.props || routeBlockConfig.props,
        children: [],
      }

      // 嵌套路由处理
      if (segments.length > 0) {
        const parentPath = `/${segments.join('/')}`
        let parentRoute = routes.find((r) => r.path === parentPath)
        if (!parentRoute) {
          parentRoute = {
            path: parentPath,
            component: layoutComponents[mergedMeta.layout],
            children: [],
          }
          routes.push(parentRoute)
        }
        parentRoute.children.push(route)
      } else {
        routes.push(route)
      }
    } catch (error) {
      console.error(`Failed to process route ${pagePath}:`, error)
    }
  }

  // 根路径处理
  // 场景一：自动处理 index.vue 生成根路由
  // 场景二：添加默认重定向逻辑
  const rootRoute = routes.find((r) => r.path === '/')
  if (!rootRoute) {
    routes.push({
      path: '/',
      redirect: '/home',
      meta: { requiresAuth: false },
    })
  }
  return routes
}

// ===================== 路径生成工具 =====================
function generateNestedPath(segments, fileName) {
  let path = fileName

  if (fileName.startsWith('[') && fileName.endsWith(']')) {
    path = `:${fileName.slice(1, -1)}`
  } else if (fileName === 'index') {
    path = segments.length === 0 ? '/' : ''
  }

  return `/${segments.join('/')}/${path}`.replace(/\/\//g, '/').replace(/\/$/, '')
}

// ===================== 路由创建 =====================
export async function createAutoRouter() {
  try {
    const routes = await generateRoutes()
    return createRouter({
      history: createWebHistory(),
      routes,
      scrollBehavior(to, from, savedPosition) {
        return savedPosition || { top: 0 }
      },
    })
  } catch (error) {
    console.error('Failed to create router:', error)
    throw error
  }
}
