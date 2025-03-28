// ===================== 导入模块 =====================
// 导入 Vue SFC 编译器的解析函数
import { parse } from '@vue/compiler-sfc'
// 导入 Vue Router 的创建路由和历史模式函数
import { createRouter, createWebHistory } from 'vue-router'

// ===================== 模块导入 =====================
// 使用 import.meta.glob 动态导入所有视图组件
const pages = import.meta.glob('../views/**/*.vue')
// 使用 import.meta.glob 动态导入所有视图组件的原始内容
const rawPages = import.meta.glob('../views/**/*.vue', { query: '?raw' })
// 使用 import.meta.glob 动态导入所有路由配置文件
const configFiles = import.meta.glob('../views/**/route.json')

// ===================== 布局组件处理 =====================
// 使用 import.meta.glob 动态导入所有布局组件，并立即加载
const layouts = import.meta.glob('../layouts/*.vue', { eager: true })
/**
 * 处理布局组件，将布局组件的名称和组件实例存储在一个对象中
 * @param {Object} layouts - 布局组件对象
 * @returns {Object} - 包含布局组件名称和组件实例的对象
 */
const layoutComponents = Object.entries(layouts).reduce((acc, [path, module]) => {
  // 从路径中提取布局组件的名称
  const layoutName = path.match(/\.\.\/layouts\/(.*)\.vue$/)?.[1] || ''
  // 如果布局组件名称存在且组件实例存在，则将其添加到结果对象中
  if (layoutName && module.default) {
    acc[layoutName] = module.default
  }
  return acc
}, {})

// ===================== 自定义块解析 =====================
/**
 * 解析 Vue 组件中的自定义路由块
 * @param {string} rawContent - 组件的原始内容
 * @returns {Object} - 解析后的路由配置对象
 */
async function parseRouteBlock(rawContent) {
  try {
    // 如果原始内容为空，则返回空对象
    if (!rawContent) return {}
    // 使用 Vue 的 SFC 编译器解析原始内容
    // rawContent.default 处理模块的默认导出
    // parse() 返回的 descriptor 包含解析后的 SFC 描述对象
    const { descriptor } = parse(rawContent.default || rawContent)
    // 查找自定义块中类型为 'route' 的块
    const routeBlock = descriptor.customBlocks?.find((b) => b.type === 'route')
    // 如果找到路由块，则解析其内容并返回，否则返回空对象
    return routeBlock ? JSON.parse(routeBlock.content) : {}
  } catch (e) {
    // 解析失败时输出错误信息
    console.error('Failed to parse route block:', e)
    return {}
  }
}

// ===================== 路由生成主逻辑 =====================
/**
 * 生成路由配置
 * @returns {Promise<Array>} - 包含路由配置的数组
 */
export async function generateRoutes() {
  // 初始化路由数组
  const routes = []

  // 遍历所有视图组件的路径
  for (const pagePath of Object.keys(pages)) {
    try {
      // 获取组件的原始内容
      const rawContent = await rawPages[pagePath]()
      // 解析组件中的自定义路由块
      const routeBlockConfig = await parseRouteBlock(rawContent)
      // 规范化路径，去除视图目录和文件扩展名
      const normalizedPath = pagePath
        .replace('../views', '')
        .replace('.vue', '')
        .replace(/\/index$/, '/')
      // 将规范化路径拆分为段
      const segments = normalizedPath.split('/').filter(Boolean)
      // 获取文件名，如果为空则默认为 'index'
      const fileName = segments.pop() || 'index'
      // 仅当页面文件是 index.vue 时才查找同级 route.json
      const isIndexFile = pagePath.endsWith('/index.vue')
      // 非 index.vue 文件不查找配置文件
      const configPath = isIndexFile ? pagePath.replace(/\/index\.vue$/, '/route.json') : null
      // 初始化 JSON 配置对象
      let jsonConfig = {}
      // 如果存在配置文件，则加载并解析其内容
      if (configFiles[configPath]) {
        jsonConfig = (await configFiles[configPath]()).default || {}
      }
      // 合并元数据，包括是否需要认证、布局名称等
      const mergedMeta = {
        // 如果文件名以 'Auth' 开头，则需要认证
        requiresAuth: fileName.startsWith('Auth'),
        // 如果路径中包含 'admin'，则使用 'AdminLayout' 布局，否则使用 'DefaultLayout' 布局
        layout: segments.includes('admin') ? 'AdminLayout' : 'DefaultLayout',
        // 合并 JSON 配置和路由块配置中的元数据
        ...jsonConfig.meta,
        ...routeBlockConfig.meta,
      }

      // 定义路由配置对象
      const route = {
        // 生成嵌套路径
        path: generateNestedPath(segments, fileName),
        // 异步加载组件
        component: () => pages[pagePath](),
        // 新增重定向配置支持
        redirect: jsonConfig.redirect || routeBlockConfig.redirect,
        // 合并后的元数据
        meta: mergedMeta,
        // 路由名称
        name: jsonConfig.name || routeBlockConfig.name,
        // 路由参数
        props: jsonConfig.props || routeBlockConfig.props,
        // 子路由数组
        children: [],
      }

      // 嵌套路由处理
      if (segments.length > 0) {
        // 构建父路由路径
        const parentPath = `/${segments.join('/')}`
        // 查找是否存在父路由
        let parentRoute = routes.find((r) => r.path === parentPath)
        if (!parentRoute) {
          // 如果不存在，则创建父路由
          parentRoute = {
            path: parentPath,
            // 使用布局组件
            component: layoutComponents[mergedMeta.layout],
            children: [],
          }
          // 将父路由添加到路由数组中
          routes.push(parentRoute)
        }
        // 将当前路由添加到父路由的子路由数组中
        parentRoute.children.push(route)
      } else {
        // 如果没有父路由，则直接将当前路由添加到路由数组中
        routes.push(route)
      }
    } catch (error) {
      // 处理路由生成过程中出现的错误
      console.error(`Failed to process route ${pagePath}:`, error)
    }
  }

  // 根路径处理
  // 场景一：自动处理 index.vue 生成根路由
  // 场景二：添加默认重定向逻辑
  const rootRoute = routes.find((r) => r.path === '/')
  if (!rootRoute) {
    // 如果没有根路由，则添加一个默认重定向路由
    routes.push({
      path: '/',
      redirect: '/home',
      meta: { requiresAuth: false },
    })
  }
  return routes
}

// ===================== 路径生成工具 =====================
/**
 * 生成嵌套路径
 * @param {Array} segments - 路径段数组
 * @param {string} fileName - 文件名
 * @returns {string} - 生成的嵌套路径
 */
function generateNestedPath(segments, fileName) {
  // 初始化路径为文件名
  let path = fileName

  // 如果文件名以 '[' 开头且以 ']' 结尾，则将其转换为动态路由参数
  if (fileName.startsWith('[') && fileName.endsWith(']')) {
    path = `:${fileName.slice(1, -1)}`
  } else if (fileName === 'index') {
    // 如果文件名是 'index'，则根据路径段的长度处理路径
    path = segments.length === 0 ? '/' : ''
  }

  // 拼接路径并处理多余的斜杠
  return `/${segments.join('/')}/${path}`.replace(/\/\//g, '/').replace(/\/$/, '')
}

// ===================== 路由创建 =====================
/**
 * 创建自动路由
 * @returns {Promise<Object>} - 创建的路由实例
 */
export async function createAutoRouter() {
  try {
    // 生成路由配置
    const routes = await generateRoutes()
    // 创建路由实例
    return createRouter({
      // 使用 HTML5 历史模式
      history: createWebHistory(),
      // 路由配置
      routes,
      // 滚动行为配置
      scrollBehavior(to, from, savedPosition) {
        return savedPosition || { top: 0 }
      },
    })
  } catch (error) {
    // 处理路由创建过程中出现的错误
    console.error('Failed to create router:', error)
    throw error
  }
}
