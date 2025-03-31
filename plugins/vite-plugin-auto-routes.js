// Use ES Module syntax (Vite handles this)
import path from 'path'
import fs from 'fs'
import fg from 'fast-glob'
import { parse } from '@vue/compiler-sfc'
import yaml from 'js-yaml'
import { v5 as uuidv5 } from 'uuid'

// --- JSDoc Type Definitions ---
/**
 * @typedef {object} RouteMeta - Route meta information.
 * @property {boolean} [requiresAuth] - If the route requires authentication.
 * @property {string} [layout] - Path to a layout component relative to `pagesDir`.
 * @property {string[]} [permissions] - Permissions required to access the route.
 * @property {string} [title] - Page title.
 * @property {any} [props] - Route props configuration.
 * @property {string | string[]} [alias] - Route aliases.
 * @property {string | object} [redirect] - Route redirect configuration.
 * @property {string} __source - Internal: source file and line number.
 */

/**
 * @typedef {object} RouteDefinitionInternal - Internal representation during generation.
 * @property {string} path          - Final path (absolute for top-level, relative for children).
 * @property {string} componentPath - Absolute path to the .vue file.
 * @property {string} name          - Route name.
 * @property {Record<string, any>} routeConfig - Parsed config from <route> block.
 * @property {RouteDefinitionInternal[]} [children] - Nested routes.
 * @property {number} priority      - Sorting priority.
 * @property {boolean} [isLayout]    - Internal flag for layout definitions.
 */

/**
 * @typedef {object} AutoRoutesPluginOptions - Plugin configuration options.
 * @property {string} [pagesDir='src/pages'] - Directory containing page components.
 * @property {string | null} [routeBlockLang=null] - Language of the <route> custom block (e.g., 'json', 'yaml'). Null means any lang.
 * @property {string} [layoutFileName='_layout.vue'] - Filename convention for layout components.
 * @property {boolean} [strict=false] - If true, plugin errors will throw and stop the build/HMR. If false, logs warnings/errors.
 */

// --- Error Reporting Helper ---
/**
 * Reports an error or warning based on strict mode.
 * @param {string} message - The message to report.
 * @param {'warn' | 'error'} level - Severity level.
 * @param {boolean} strict - Whether strict mode is enabled.
 * @param {import('vite').ViteDevServer} [server] - Optional Vite server instance for error overlay.
 */
function reportError(message, level, strict, server) {
  const fullMessage = `[vite-plugin-auto-routes] ${message}`
  if (strict && level === 'error') {
    // Only throw for actual errors in strict mode
    throw new Error(fullMessage)
  } else {
    if (level === 'error') {
      console.error(fullMessage)
      // Attempt to show error overlay in dev mode for errors
      server?.ws.send({
        type: 'error',
        err: { message: fullMessage, stack: '', plugin: 'vite-plugin-auto-routes' },
      })
    } else {
      // Always log warnings regardless of strict mode
      console.warn(fullMessage)
    }
  }
}

// --- RouteValidator Class ---
class RouteValidator {
  /** Validates route metadata */
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
    } // Meta issues are warnings
  }

  /** Validates route path */
  /** @param {string} routePath */
  /** @param {string} filePath */
  /** @param {boolean} strict */
  /** @returns {boolean} */
  static validatePath(routePath, filePath, strict) {
    let isValid = true
    // Path must be a non-empty string starting with '/'
    if (
      typeof routePath !== 'string' ||
      !routePath.startsWith('/') ||
      (routePath.length === 0 && routePath !== '/')
    ) {
      reportError(
        `路径验证失败: ${filePath}\n  - 路径无效: "${routePath}" (必须是以 / 开头的非空字符串)`,
        'error',
        strict,
      )
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
const UUID_NAMESPACE = 'd9b9a2e0-c9b3-4b4a-9f3a-2c8d7f6b5c6d' // For deterministic UUIDs
const VIRTUAL_MODULE_ID = 'virtual:auto-routes'
const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}` // Vite convention for virtual modules
const ROUTER_VIEW_REGEX = /<router-view\s*\/?>/i // Regex to check for <router-view> presence

/**
 * The main Vite plugin function.
 * @param {AutoRoutesPluginOptions} [options={}] - Plugin options.
 * @returns {import('vite').Plugin} - The Vite plugin object.
 */
export function autoRoutesPlugin(options = {}) {
  // Destructure options with defaults
  const {
    pagesDir = 'src/pages', // Default directory to scan
    routeBlockLang = null, // Default: parse <route> regardless of lang
    layoutFileName = '_layout.vue', // Default layout file name
    strict = false, // Default: don't throw errors, just log
  } = options

  // Resolve the absolute path to the pages directory
  const pagesDirPath = path.resolve(process.cwd(), pagesDir)
  // Variable to hold the generated code string for the virtual module
  let generatedRoutesCode = 'export const routes = [];'
  // Variable to hold the Vite dev server instance (for HMR and error overlay)
  /** @type {import('vite').ViteDevServer | undefined} */
  let viteServer

  // --- Helper Functions ---

  /** Generates a Vue Router path from a file path relative to pagesDir. */
  const generateRoutePath = (filePath) => {
    const relativePath = path.relative(pagesDirPath, filePath)
    let routePath = `/${relativePath}`
      .replace(/\\/g, '/')
      .replace(/\.vue$/, '') // Normalize, remove extension
      .replace(/\[\.\.\.(.*?)\]/g, ':$1(.*)') // Catch-all: [...slug] -> :slug(.*)
      .replace(/\[(.*?)\]/g, ':$1') // Dynamic: [id] -> :id
    // Handle 'index' routes -> map to parent directory path or '/'
    if (routePath.endsWith('/index')) routePath = routePath.slice(0, -6) || '/'
    // Ensure root index maps correctly to '/'
    if (routePath === '/index') routePath = '/'
    // Return '/' if path calculation resulted in empty string (e.g., root index)
    return routePath || '/'
  }

  /** Generates a unique and deterministic route name from a file path. */
  const generateRouteName = (filePath) => {
    // Create a sanitized base name from the relative path
    const relativePath = path
      .relative(pagesDirPath, filePath)
      .replace(/\\/g, '/')
      .replace(/\.vue$/, '')
      .replace(/[^a-zA-Z0-9_\-\/]/g, '')
    // Generate a deterministic hash based on the path
    const deterministicHash = uuidv5(relativePath, UUID_NAMESPACE).substring(0, 8)
    // Combine parts for a readable yet unique name
    const readableName = relativePath
      .replace(/^\//, '')
      .replace(/\//g, '-')
      .replace(/[:.*()\[\]]/g, '_') // Replace special route chars
    return `route-${readableName || 'index'}-${deterministicHash}`
  }

  /** Calculates a priority score for sorting routes (more specific routes first). */
  const calculatePriority = (routePath) => {
    let score = 100 // Base score
    if (routePath === '/') score += 10 // Root has higher priority
    score -= routePath.split('/').filter(Boolean).length * 2 // Depth penalty
    if (routePath.includes(':')) score -= 5 // Dynamic routes lower
    if (routePath.includes('(.*)')) score -= 20 // Catch-all lowest
    return score
  }

  /** Parses the <route> block from a .vue file. */
  const parseRouteBlock = async (componentPath) => {
    try {
      const content = fs.readFileSync(componentPath, 'utf-8')
      const { descriptor } = parse(content) // Parse SFC structure
      const block = descriptor.customBlocks.find(
        (b) => b.type === 'route' && (routeBlockLang === null || b.lang === routeBlockLang),
      )

      // If no matching block found, return minimal object
      if (!block?.content) {
        return {
          config: { meta: { __source: path.relative(process.cwd(), componentPath) + ':0' } },
          line: 0,
        }
      }

      // Determine if content is YAML or JSON
      const isYaml =
        block.content.trim().startsWith('---') || block.lang === 'yaml' || block.lang === 'yml'
      const config = (isYaml ? yaml.load(block.content) : JSON.parse(block.content)) || {} // Parse content

      // Ensure meta exists and add source information
      config.meta = config.meta || {}
      config.meta.__source = `${path.relative(process.cwd(), componentPath)}:${block.loc.start.line}`

      return { config, line: block.loc.start.line }
    } catch (error) {
      // Report parsing error (respects strict mode)
      const message = error instanceof Error ? error.message : String(error)
      reportError(
        `解析 <route> 块失败: ${componentPath}\n  ${message}`,
        'error',
        strict,
        viteServer,
      )
      return null // Return null to indicate failure
    }
  }

  /** Checks if a layout file contains <router-view>. */
  const checkLayoutForRouterView = (layoutFile) => {
    try {
      const content = fs.readFileSync(layoutFile, 'utf-8')
      if (!ROUTER_VIEW_REGEX.test(content)) {
        // Report warning (or error in strict mode)
        reportError(
          `布局文件可能缺少 <router-view>: ${path.relative(process.cwd(), layoutFile)}`,
          'warn',
          strict,
          viteServer,
        )
      }
    } catch (error) {
      // Report error if reading file fails
      const message = error instanceof Error ? error.message : String(error)
      reportError(`读取布局文件失败: ${layoutFile}\n  ${message}`, 'error', strict, viteServer)
    }
  }

  // --- Core Logic (Corrected Nesting Logic) ---
  /**
   * Generates the nested route definition tree.
   * @returns {Promise<RouteDefinitionInternal[]>} The sorted array of root route definitions.
   */
  const generateRoutesDefinition = async () => {
    // 1. Scan Files
    const [pageFiles, layoutFiles] = await Promise.all([
      fg([`${pagesDirPath}/**/*.vue`], {
        ignore: [`**/${layoutFileName}`, `**/components/**`, '**/_*/**'],
        absolute: true,
        onlyFiles: true,
      }),
      fg([`${pagesDirPath}/**/${layoutFileName}`], { absolute: true, onlyFiles: true }),
    ])

    // 2. Process Layouts into a lookup structure
    /** @type {Map<string, RouteDefinitionInternal>} */
    const layoutMap = new Map() // Map layout directory path to layout definition
    for (const layoutFile of layoutFiles) {
      const parseResult = await parseRouteBlock(layoutFile)
      if (!parseResult) continue
      const { config } = parseResult
      const layoutDirPath = path.dirname(layoutFile)
      const layoutRoutePath = generateRoutePath(layoutDirPath)

      if (
        !RouteValidator.validatePath(layoutRoutePath, config.meta?.__source || layoutFile, strict)
      )
        continue
      RouteValidator.validateMeta(config.meta, config.meta?.__source || layoutFile, strict)
      checkLayoutForRouterView(layoutFile)

      // Store layout definition, ready to accept children
      layoutMap.set(layoutDirPath, {
        path: layoutRoutePath, // Absolute path for the layout route
        componentPath: layoutFile,
        name: config.name || generateRouteName(layoutFile).replace('layout', 'layout-parent'),
        routeConfig: config,
        children: [],
        isLayout: true,
        priority: calculatePriority(layoutRoutePath) - 1,
      })
    }

    // 3. Process Pages and Assign to Layouts or Top Level
    /** @type {RouteDefinitionInternal[]} */
    const finalRoutes = [] // Will hold the final output list
    const assignedToLayout = new Set() // Keep track of files assigned as children

    // Create page definitions first
    const pageDefs = []
    for (const pageFile of pageFiles) {
      const parseResult = await parseRouteBlock(pageFile)
      if (!parseResult) continue
      const { config } = parseResult
      const autoPath = generateRoutePath(pageFile)
      const finalPath = config.path || autoPath // Absolute path for matching

      if (!RouteValidator.validatePath(finalPath, config.meta?.__source || pageFile, strict))
        continue
      RouteValidator.validateMeta(config.meta, config.meta?.__source || pageFile, strict)

      pageDefs.push({
        path: finalPath, // Store absolute path for now
        componentPath: pageFile,
        name: config.name || generateRouteName(pageFile),
        routeConfig: config,
        priority: calculatePriority(finalPath),
      })
    }

    // Attempt to assign pages to layouts (iterate layouts by path length descending for correct nesting)
    const sortedLayoutPaths = Array.from(layoutMap.keys()).sort((a, b) => b.length - a.length)

    for (const layoutDirPath of sortedLayoutPaths) {
      const layoutDef = layoutMap.get(layoutDirPath)
      if (!layoutDef) continue // Should not happen

      for (const pageDef of pageDefs) {
        // Skip page if already assigned or if it's the layout file itself
        if (
          assignedToLayout.has(pageDef.componentPath) ||
          pageDef.componentPath === layoutDef.componentPath
        )
          continue

        // Check if page is inside the layout directory
        if (
          path.dirname(pageDef.componentPath) === layoutDirPath ||
          pageDef.componentPath.startsWith(layoutDirPath + path.sep)
        ) {
          // It's within the layout's directory or subdirectories
          const layoutRoutePath = layoutDef.path
          const pageRoutePath = pageDef.path

          // Calculate relative path
          let childPath = ''
          if (pageRoutePath.length > layoutRoutePath.length) {
            childPath = pageRoutePath.slice(layoutRoutePath.length).replace(/^\//, '')
          }

          // Special case: index file inside layout dir becomes the default child ('')
          const isIndexFile = path.basename(pageDef.componentPath) === 'index.vue'
          if (path.dirname(pageDef.componentPath) === layoutDirPath && isIndexFile) {
            childPath = ''
          }

          // Add as child, mark as assigned
          layoutDef.children?.push({ ...pageDef, path: childPath }) // Add with relative path
          assignedToLayout.add(pageDef.componentPath)
        }
      }
      // Add the layout route definition (with children populated) to the final list
      finalRoutes.push(layoutDef)
    }

    // 4. Add Remaining Unassigned Pages as Top-Level Routes
    for (const pageDef of pageDefs) {
      if (!assignedToLayout.has(pageDef.componentPath)) {
        finalRoutes.push(pageDef) // Add with its original absolute path
      }
    }

    // 5. Sort Final Routes and Children Recursively
    /** @param {RouteDefinitionInternal[]} routes */
    const sortRoutes = (routes) => {
      if (!routes) return []
      routes.sort((a, b) => b.priority - a.priority)
      routes.forEach((route) => {
        if (route.children?.length > 0) {
          route.children = sortRoutes(route.children)
        } else {
          // Clean up empty children arrays
          delete route.children
        }
      })
      return routes
    }

    return sortRoutes(finalRoutes)
  }

  // --- checkForDuplicateNames (Should work with nested structure now) ---
  const checkForDuplicateNames = (routes) => {
    /** @type {Map<string, string>} */ const nameMap = new Map()
    /** @param {RouteDefinitionInternal[]} currentRoutes */ const collectNames = (
      currentRoutes,
    ) => {
      if (!currentRoutes) return
      for (const route of currentRoutes) {
        if (route.name) {
          const source = route.routeConfig?.meta?.__source || route.componentPath
          if (nameMap.has(route.name)) {
            reportError(
              `发现重复的路由名称: "${route.name}".\n  - 首次: ${nameMap.get(route.name)}\n  - 重复: ${source}`,
              'error',
              strict,
              viteServer,
            )
          } else {
            nameMap.set(route.name, source)
          }
        }
        if (route.children) {
          collectNames(route.children)
        } // Recurse if children exist
      }
    }
    collectNames(routes)
  }

  // --- generateModuleCode (Should work with corrected structure) ---
  const generateModuleCode = (routes) => {
    /* ... (Same 'improved' version as before) ... */
    const generateRouteCode = (routeDefs, indentationLevel = 0) => {
      const indent = ' '.repeat(indentationLevel * 2)
      const childIndent = ' '.repeat((indentationLevel + 1) * 2)
      return `[\n${routeDefs
        .map((route) => {
          const relativeComponentPath = `/${path.relative(process.cwd(), route.componentPath).replace(/\\/g, '/')}`
          const componentImportString = `() => import('${relativeComponentPath}')`
          const {
            name: _name,
            path: _path,
            component: _comp,
            children: _children,
            ...restConfig
          } = route.routeConfig || {}
          let routeString = `${childIndent}{\n`
          routeString += `${childIndent}  path: ${JSON.stringify(route.path)},\n`
          routeString += `${childIndent}  name: ${JSON.stringify(route.name)},\n`
          routeString += `${childIndent}  component: ${componentImportString}` // No trailing comma needed after component if nothing follows
          const restEntries = Object.entries(restConfig)
          if (restEntries.length > 0) {
            routeString += `,\n` // Add comma after component if there are more props
            routeString += restEntries
              .map(([key, value]) => {
                const valueString = JSON.stringify(value, null, 2)
                const indentedValueString = valueString.includes('\n')
                  ? valueString.replace(/\n/g, `\n${childIndent}  `)
                  : valueString
                return `${childIndent}  ${JSON.stringify(key)}: ${indentedValueString}`
              })
              .join(',\n')
          }
          if (route.children?.length > 0) {
            if (restEntries.length > 0) routeString += `,\n`
            else routeString += `,\n` // Need comma before children
            routeString += `${childIndent}  children: ${generateRouteCode(route.children, indentationLevel + 1)}`
          }
          routeString += `\n${childIndent}}`
          return routeString
        })
        .join(',\n')}\n${indent}]`
    }
    const finalCode = generateRouteCode(routes)
    // console.log("Generated Routes Code:\n", finalCode); // Debug output
    return `export const routes = ${finalCode};`
  }

  // --- Trigger Route Regeneration ---
  async function regenerateRoutes() {
    /* ... (Same: Calls generateRoutesDefinition, checkForDuplicateNames, generateModuleCode, invalidateModule) ... */
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
    /* ... (Same: name, enforce, configureServer, resolveId, load, buildStart, handleHotUpdate) ... */
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
        console.log('[自动路由] 初始路由配置完成.')
      } catch (error) {
        if (!strict) console.error('[自动路由] buildStart 失败:', error)
        else throw error
      }
    },
    async handleHotUpdate({ file, server }) {
      const pagesDirRelative = path.relative(process.cwd(), pagesDirPath)
      if (file.startsWith(path.join(process.cwd(), pagesDirRelative) + path.sep)) {
        console.log(`[自动路由] 文件变更: ${path.relative(process.cwd(), file)}...`)
        viteServer = server
        try {
          await regenerateRoutes()
          server.ws.send({ type: 'full-reload', path: '*' })
          console.log('[自动路由] 路由已更新，正在重新加载页面...')
        } catch (error) {
          if (!strict) console.error(`[自动路由] HMR 失败 (详细信息见上).`)
        }
      }
    },
  }
}
