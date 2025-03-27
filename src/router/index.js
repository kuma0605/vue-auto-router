import { defineAsyncComponent } from 'vue'
import { parse } from '@vue/compiler-sfc'
import { createRouter, createWebHistory } from 'vue-router'

// ===================== 模块导入 =====================
const pages = import.meta.glob('../views/**/*.vue')
const rawPages = import.meta.glob('../views/**/*.vue', { query: '?raw' })
const configFiles = import.meta.glob('../views/**/route.json', { eager: true })

// ===================== 布局组件处理 =====================
const layouts = import.meta.glob('../layouts/*.vue', { eager: true, import: 'default' })
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
    const { descriptor } = parse(rawContent.default || rawContent)
    console.log('descriptor', descriptor)
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

      console.log('rawContent', rawContent)
      const routeBlockConfig = await parseRouteBlock(rawContent)
      console.log('routeBlockConfig', routeBlockConfig)
      const normalizedPath = pagePath
        .replace('../views', '')
        .replace('.vue', '')
        .replace(/\/index$/, '/')
      console.log('normalizedPath', normalizedPath)
      const segments = normalizedPath.split('/').filter(Boolean)
      const fileName = segments.pop() || 'index'
      console.log('segments', segments)
      console.log('fileName', fileName)

      const configPath = pagePath.replace('.vue', '.json')
      const jsonConfig = configFiles[configPath]?.default || {}
      console.log('configPath', configPath)
      console.log('jsonConfig', jsonConfig)
      const mergedMeta = {
        requiresAuth: fileName.startsWith('Auth'),
        layout: segments.includes('admin') ? 'AdminLayout' : 'DefaultLayout',
        ...jsonConfig.meta,
        ...routeBlockConfig.meta,
      }
      console.log('mergedMeta', mergedMeta)

      const route = {
        path: generateNestedPath(segments, fileName),
        /* component: defineAsyncComponent({
          loader: pages[pagePath],
          loadingComponent: () => import('../components/LoadingSpinner.vue'),
          delay: 200,
          timeout: 3000,
        }), */
        component: pages[pagePath],
        meta: mergedMeta,
        name: jsonConfig.name || routeBlockConfig.name,
        props: jsonConfig.props || routeBlockConfig.props,
        children: [],
      }
      console.log('route', route)
      console.log('——分割线——')

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

  console.log(routes)
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
