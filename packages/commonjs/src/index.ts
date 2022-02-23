import path from 'path'
import { Plugin, ResolvedConfig } from 'vite'
import {
  DEFAULT_EXTENSIONS,
  KNOWN_PLUGINS,
  cleanUrl,
  isCommonjs,
} from './utils'
import cjs2esm from './cjs-esm'

export interface CommonjsOptions {
  /**
   * By default
   * - First priority use `config.resolve.extensions` if it exists  
   * - Second priority use default extensions - `['.js', '.jsx', '.ts', '.tsx', '.vue']`
   */
  extensions?: string[]
  ignore?: (...args: Parameters<Plugin['transform']>) => boolean
}

export default function commonjs(options: CommonjsOptions = {}): Plugin {
  const COMMONJS_PLUGIN_NAME = 'vite-plugin-commonjs'
  let config: ResolvedConfig

  return {
    name: COMMONJS_PLUGIN_NAME,
    apply: 'serve',
    config(_config) {
      /**
       * 'vite-plugin-commonjs' can only transform JavaScript.
       * So it should be put behind some known plugins.
       */
      const plugins = _config.plugins as Plugin[]
      const knownNames = Object.values(KNOWN_PLUGINS).flat()
      const pluginNames = plugins.map(plugin => plugin.name)
      const orderIndex = pluginNames.reverse().findIndex(name => knownNames.includes(name))
      if (orderIndex !== -1) {
        const commonjsIndex = pluginNames.findIndex(name => name === COMMONJS_PLUGIN_NAME)
        const commonjsPlugin = plugins.splice(commonjsIndex, 1)[0]
        if (commonjsIndex < orderIndex) {
          // It is located before a known plugin
          // Move it to after known plugins
          plugins.splice(orderIndex, 0, commonjsPlugin)
        }
        _config.plugins = plugins
        return _config
      }
    },
    configResolved(_config) {
      config = _config
    },
    transform(code, id, opts) {
      const extensions = options.extensions || config.resolve?.extensions || DEFAULT_EXTENSIONS
      const { ext } = path.parse(cleanUrl(id))
      if (!extensions.includes(ext)) {
        return null
      }
      if (options.ignore && options.ignore.call(this, code, id, opts)) {
        return null
      }
      if (!isCommonjs(code)) {
        return null
      }

      // -------------------------------------------------

      return cjs2esm.call(this, code, id)
    },
  }
}
