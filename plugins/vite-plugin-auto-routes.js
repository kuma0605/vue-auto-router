// Use ES Module syntax (Vite handles this)
import path from 'path'
import fs from 'fs'
import fg from 'fast-glob'
import { parse } from '@vue/compiler-sfc'
import yaml from 'js-yaml'
import { v5 as uuidv5 } from 'uuid'

// --- JSDoc Type Definitions ---
/**
 * @typedef {object} RouteMeta
 * @property {boolean} [requiresAuth]
 * @property {string} [layout]
 * @property {string[]} [permissions]
 * @property {string} [title]
 * @property {any} [props]
 * @property {string | string[]} [alias]
 * @property {string | object} [redirect]
 * @property {string} __source
 */

/**
 * @typedef {object} RouteDefinitionInternal
 * @property {string} path
 * @property {string} componentPath
 * @property {string} name
 * @property {Record<string, any>} routeConfig
 * @property {RouteDefinitionInternal[]} [children]
 * @property {number} priority
 * @property {boolean} [isLayout]
 */

/**
 * @typedef {object} AutoRoutesPluginOptions
 * @property {string} [pagesDir='src/pages'] - Directory containing page components.
 * @property {string | null} [routeBlockLang=null] - Language of the <route> custom block.
 * @property {string} [layoutFileName='_layout.vue'] - Filename convention for layout components.
 * @property {boolean} [strict=false] - If true, plugin errors will throw and stop the build/HMR.
 */

// --- Error Reporting Helper ---
/**
 * @param {string} message
 * @param {'warn' | 'error'} level
 * @param {boolean} strict
 * @param {import('vite').ViteDevServer} [server]
 */
function reportError(message, level, strict, server) {
  const fullMessage = `[vite-plugin-auto-routes] ${message}`
  if (strict) {
    throw new Error(fullMessage)
  } else {
    if (level === 'error') {
      console.error(fullMessage)
      server?.ws.send({
        type: 'error',
        err: { message: fullMessage, stack: '', plugin: 'vite-plugin-auto-routes' },
      })
    } else {
      console.warn(fullMessage)
    }
  }
}

// --- RouteValidator Class ---
class RouteValidator {
  /** @param {Record<string, any>} meta */
  /** @param {string} filePath */
  /** @param {boolean} strict */
  static validateMeta(meta = {}, filePath, strict) {
    const errors = []
    if ('requiresAuth' in meta && typeof meta.requiresAuth !== 'boolean') {
      errors.push('"requiresAuth" 必须是布尔值')
    }
    if ('layout' in meta && typeof meta.layout !== 'string') {
      errors.push('"layout" 必须是字符串')
    }
    if ('permissions' in meta && !Array.isArray(meta.permissions)) {
      errors.push('"permissions" 必须是字符串数组')
    }
    if (errors.length > 0) {
      reportError(`路由元数据验证失败: ${filePath}\n  - ${errors.join('\n  - ')}`, 'warn', strict)
    }
  }

  /** @param {string} routePath */
  /** @param {string} filePath */
  /** @param {boolean} strict */
  /** @returns {boolean} */
  static validatePath(routePath, filePath, strict) {
    let isValid = true
    if (typeof routePath !== 'string' || !routePath.startsWith('/')) {
      reportError(`路径验证失败: ${filePath}\n  - 路径无效: "${routePath}"`, 'error', strict)
      isValid = false
    }
    if (/\s/.test(routePath)) {
      reportError(`路径验证失败: ${filePath}\n  - 路径含空格: "${routePath}"`, 'error', strict)
      isValid = false
    }
    return isValid
  }
}

// --- Constants ---
const UUID_NAMESPACE = 'd9b9a2e0-c9b3-4b4a-9f3a-2c8d7f6b5c6d'
const VIRTUAL_MODULE_ID = 'virtual:auto-routes'
const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`
const ROUTER_VIEW_REGEX = /<router-view\s*\/?>/i

/**
 * @param {AutoRoutesPluginOptions} [options={}]
 * @returns {import('vite').Plugin}
 */
export function autoRoutesPlugin(options = {}) {
  const {
    pagesDir = 'src/pages',
    routeBlockLang = null,
    layoutFileName = '_layout.vue',
    strict = false,
  } = options

  const pagesDirPath = path.resolve(process.cwd(), pagesDir)
  let generatedRoutesCode = 'export const routes = [];'
  /** @type {import('vite').ViteDevServer | undefined} */
  let viteServer

  // --- Helper Functions ---
  const generateRoutePath = (filePath) => {
    const relativePath = path.relative(pagesDirPath, filePath)
    let routePath = `/${relativePath}`
      .replace(/\\/g, '/')
      .replace(/\.vue$/, '')
      .replace(/\[\.\.\.(.*?)\]/g, ':$1(.*)')
      .replace(/\[(.*?)\]/g, ':$1')
    if (routePath.endsWith('/index')) routePath = routePath.slice(0, -6) || '/'
    if (routePath === '/index') routePath = '/'
    return routePath || '/'
  }
  const generateRouteName = (filePath) => {
    const relativePath = path
      .relative(pagesDirPath, filePath)
      .replace(/\\/g, '/')
      .replace(/\.vue$/, '')
      .replace(/[^a-zA-Z0-9_\-\/]/g, '')
    const deterministicHash = uuidv5(relativePath, UUID_NAMESPACE).substring(0, 8)
    const readableName = relativePath
      .replace(/^\//, '')
      .replace(/\//g, '-')
      .replace(/[:.*()]/g, '_')
    return `route-${readableName || 'index'}-${deterministicHash}`
  }
  const calculatePriority = (routePath) => {
    let score = 100
    if (routePath === '/') score += 10
    score -= routePath.split('/').filter(Boolean).length * 2
    if (routePath.includes(':')) score -= 5
    if (routePath.includes('(.*)')) score -= 20
    return score
  }
  const parseRouteBlock = async (componentPath) => {
    let content = ''
    try {
      content = fs.readFileSync(componentPath, 'utf-8')
      const { descriptor } = parse(content)
      const block = descriptor.customBlocks.find(
        (b) => b.type === 'route' && (routeBlockLang === null || b.lang === routeBlockLang),
      )
      if (!block?.content)
        return {
          config: { meta: { __source: path.relative(process.cwd(), componentPath) + ':0' } },
          line: 0,
        }
      const isYaml =
        block.content.trim().startsWith('---') || block.lang === 'yaml' || block.lang === 'yml'
      const config = (isYaml ? yaml.load(block.content) : JSON.parse(block.content)) || {}
      config.meta = config.meta || {}
      config.meta.__source = `${path.relative(process.cwd(), componentPath)}:${block.loc.start.line}`
      return { config, line: block.loc.start.line }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      reportError(
        `解析 <route> 块失败: ${componentPath}\n  ${message}`,
        'error',
        strict,
        viteServer,
      )
      return null
    }
  }
  const checkLayoutForRouterView = (layoutFile) => {
    try {
      const content = fs.readFileSync(layoutFile, 'utf-8')
      if (!ROUTER_VIEW_REGEX.test(content)) {
        reportError(
          `布局文件可能缺少 <router-view>: ${path.relative(process.cwd(), layoutFile)}`,
          'warn',
          strict,
          viteServer,
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      reportError(`读取布局文件失败: ${layoutFile}\n  ${message}`, 'error', strict, viteServer)
    }
  }

  // --- Core Logic ---
  const generateRoutesDefinition = async () => {
    const [pageFiles, layoutFiles] = await Promise.all([
      fg([`${pagesDirPath}/**/*.vue`], {
        ignore: [`**/${layoutFileName}`, `**/components/**`, '**/_*/**'],
        absolute: true,
        onlyFiles: true,
      }),
      fg([`${pagesDirPath}/**/${layoutFileName}`], { absolute: true, onlyFiles: true }),
    ])
    /** @type {RouteDefinitionInternal[]} */
    const routeDefs = []
    const processedLayoutPaths = new Set()
    // 1. Process Layouts
    for (const layoutFile of layoutFiles) {
      if (processedLayoutPaths.has(layoutFile)) continue
      const parseResult = await parseRouteBlock(layoutFile)
      if (!parseResult) continue
      const { config } = parseResult
      const layoutRoutePath = generateRoutePath(path.dirname(layoutFile))
      if (
        !RouteValidator.validatePath(layoutRoutePath, config.meta?.__source || layoutFile, strict)
      )
        continue
      RouteValidator.validateMeta(config.meta, config.meta?.__source || layoutFile, strict)
      checkLayoutForRouterView(layoutFile)
      routeDefs.push({
        path: layoutRoutePath,
        componentPath: layoutFile,
        name: config.name || generateRouteName(layoutFile).replace('layout', 'layout-parent'),
        routeConfig: config,
        children: [],
        isLayout: true,
        priority: calculatePriority(layoutRoutePath) - 1,
      })
      processedLayoutPaths.add(layoutFile)
    }
    // 2. Process Pages
    for (const pageFile of pageFiles) {
      const parseResult = await parseRouteBlock(pageFile)
      if (!parseResult) continue
      const { config } = parseResult
      const autoPath = generateRoutePath(pageFile)
      const finalPath = config.path || autoPath
      if (!RouteValidator.validatePath(finalPath, config.meta?.__source || pageFile, strict))
        continue
      RouteValidator.validateMeta(config.meta, config.meta?.__source || pageFile, strict)
      /** @type {RouteDefinitionInternal} */ const routeDef = {
        path: finalPath,
        componentPath: pageFile,
        name: config.name || generateRouteName(pageFile),
        routeConfig: config,
        priority: calculatePriority(finalPath),
      }
      let parentLayout
      let maxMatchLength = -1
      for (const layoutDef of routeDefs) {
        if (
          layoutDef.isLayout &&
          finalPath.startsWith(layoutDef.path === '/' ? '/' : `${layoutDef.path}/`)
        ) {
          if (layoutDef.path.length > maxMatchLength) {
            maxMatchLength = layoutDef.path.length
            parentLayout = layoutDef
          }
        }
      }
      if (parentLayout) {
        let childPath = finalPath.slice(parentLayout.path.length).replace(/^\//, '')
        if (childPath === 'index' || (parentLayout.path === '/' && finalPath === '/'))
          childPath = ''
        parentLayout.children?.push({ ...routeDef, path: childPath })
      } else {
        routeDefs.push(routeDef)
      }
    }
    // 3. Filter & Sort
    const finalRoutes = routeDefs.filter(
      (r) => !r.isLayout || (r.isLayout && r.children && r.children.length > 0),
    )
    const sortRoutes = (routes) => {
      routes.sort((a, b) => b.priority - a.priority)
      routes.forEach((route) => {
        if (route.children) route.children = sortRoutes(route.children)
      })
      return routes
    }
    return sortRoutes(finalRoutes)
  }
  const checkForDuplicateNames = (routes) => {
    /** @type {{ name: string, source: string }[]} */ const names = []
    /** @param {RouteDefinitionInternal[]} currentRoutes */ const collectNames = (
      currentRoutes,
    ) => {
      for (const route of currentRoutes) {
        if (route.name)
          names.push({
            name: route.name,
            source: route.routeConfig.meta?.__source || route.componentPath,
          })
        if (route.children) collectNames(route.children)
      }
    }
    collectNames(routes)
    const nameMap = new Map()
    for (const { name, source } of names) {
      if (nameMap.has(name)) {
        reportError(
          `发现重复的路由名称: "${name}"。\n  - 首次: ${nameMap.get(name)}\n  - 重复: ${source}`,
          'error',
          strict,
          viteServer,
        )
      } else {
        nameMap.set(name, source)
      }
    }
  }
  const generateModuleCode = (routes) => {
    const generateRouteCode = (routeDefs) => {
      return `[${routeDefs
        .map((route) => {
          const relativeComponentPath = `/${path.relative(process.cwd(), route.componentPath).replace(/\\/g, '/')}`
          const componentImport = `() => import('${relativeComponentPath}')`
          const {
            name: _name,
            path: _path,
            component: _comp,
            children: _children,
            ...restConfig
          } = route.routeConfig
          restConfig.meta = restConfig.meta || {}
          let routeObject = `{ path: '${route.path}', name: '${route.name}', component: ${componentImport}, ${Object.entries(
            restConfig,
          )
            .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
            .join(',\n')}${Object.keys(restConfig).length > 0 ? ',' : ''} }`
          if (route.children?.length > 0) {
            const childrenCode = generateRouteCode(route.children)
            routeObject = routeObject.slice(0, -1) + `, children: ${childrenCode} }`
          }
          return routeObject
        })
        .join(',\n')}]`
    }
    return `export const routes = ${generateRouteCode(routes)};`
  }

  // --- Trigger Route Regeneration (no internal log) ---
  async function regenerateRoutes() {
    const routes = await generateRoutesDefinition()
    checkForDuplicateNames(routes)
    generatedRoutesCode = generateModuleCode(routes)
    if (viteServer) {
      const mod = viteServer.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID)
      if (mod) viteServer.moduleGraph.invalidateModule(mod)
    }
  }

  // --- Vite Plugin Hooks ---
  return {
    name: 'vite-plugin-auto-routes',
    enforce: 'pre',
    configureServer(_server) {
      viteServer = _server
    },
    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) return RESOLVED_VIRTUAL_MODULE_ID
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) return generatedRoutesCode
    },

    async buildStart() {
      try {
        await regenerateRoutes()
        // Log message after successful initial generation
        console.log('[自动路由] 初始路由配置完成.') // <--- Added this log
      } catch (error) {
        if (!strict) console.error('[自动路由] buildStart 失败:', error)
        else throw error
      }
    },

    async handleHotUpdate({ file, server }) {
      const pagesDirRelative = path.relative(process.cwd(), pagesDirPath)
      // Check if the changed file is within the configured pagesDir
      if (file.startsWith(path.join(process.cwd(), pagesDirRelative) + path.sep)) {
        console.log(`[自动路由] 文件变更: ${path.relative(process.cwd(), file)}...`)
        viteServer = server // Ensure server instance is up-to-date
        try {
          await regenerateRoutes() // Regenerate routes silently
          server.ws.send({ type: 'full-reload', path: '*' }) // Trigger full reload
          // Consolidated HMR log message
          console.log('[自动路由] 路由已更新，正在重新加载页面...')
        } catch (error) {
          // Error reporting/throwing is handled within regenerateRoutes via reportError
          if (!strict) console.error(`[自动路由] HMR 失败 (详细信息见上).`)
        }
      }
    },
  }
}
