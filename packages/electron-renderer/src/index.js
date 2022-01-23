const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');
const { ensureDir, node_modules } = require('./utils');

/** @type {import('./types').VitePluginElectronRenderer} */
module.exports = function (options = {}) {
  const { resolve } = options;
  let root = process.cwd();
  const name = 'vite-plugin-electron-renderer';
  const browserExternalId = '__vite-browser-external'
  const ElectronRendererModule = path.join(__dirname, '../modules/electron-renderer.js');

  return {
    name,
    config(config, env) {
      if (config.root && path.isAbsolute(config.root)) {
        // TODO: config.root is relative path
        root = config.root;
      }

      modifyOptionsForElectron(config);

      // in 'vite serve' phase ensure the 'electron' and NodeJs built-in modules are loaded correctly by modifying the alias
      if (env.command === 'serve') {
        modifyOptimizeDeps(config, ['electron']);
        modifyAlias(config, [{ electron: ElectronRendererModule }]);
      }
      // in 'vite build' phase insert 'electron' and NodeJs built-in modules into Rollup `output.external`
      else if (env.command === 'build') {
        modifyRollupExternal(config);
      }

      if (resolve) {
        const cacheDir = path.join(node_modules(root), `.${name}`);
        const resolveKeys = Object.keys(resolve);

        modifyOptimizeDeps(config, resolveKeys);

        // generate resolve-module file to `node_modules/.vite-plugin-electron-renderer`
        generateESModule(cacheDir, resolve);
        // redirect resolve-module to `node_modules/.vite-plugin-electron-renderer`
        modifyAlias(config, resolveKeys.map(moduleId => ({ [moduleId]: path.join(cacheDir, moduleId) })));
      }
    },
    configureServer(server) {
      // intercept node built-in modules require, convert to ESModule respond
      server.middlewares.use((req, res, next) => {
        if ((req.url || '').includes(browserExternalId)) {
          const builtinId = req.url.split(`${browserExternalId}:`, 2)[1];
          if (builtinModules.includes(builtinId)) {
            const builtinModule = require(builtinId);
            const members = Object.keys(builtinModule);
            const code = `
const _M = require("${builtinId}");
const {
  ${members.join(',\n  ')}
} = _M;

export { _M as default, ${members.join(', ')} }
`;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Cache-Control', 'max-age=3600'); // an hour of cache
            res.end(code);
            return;
          }
        }
        next();
      });
    },
  };
}

/** @type {import('./types').GenerateESModule} */
function generateESModule(
  cacheDir,
  resolveDict,
) {
  // generate custom-resolve module file
  for (const [module, strOrFn] of Object.entries(resolveDict)) {
    const moduleId = path.join(cacheDir, module + '.js');
    const moduleContent = typeof strOrFn === 'function' ? strOrFn() : strOrFn;

    // for '@scope/name' module
    ensureDir(path.parse(moduleId).dir);
    // write custom-resolve
    fs.writeFileSync(moduleId, moduleContent);
  }
}

/** @type {import('./types').ModifyAlias} */
function modifyAlias(
  config,
  aliaList,
) {
  if (!config.resolve) config.resolve = {};

  let alias = config.resolve.alias || {};
  if (!Array.isArray(alias)) {
    // keep the the original alias
    alias = Object.entries(alias).map(([k, v]) => ({ find: k, replacement: v }));
  }
  alias.push(...aliaList.map(item => {
    const [find, replacement] = Object.entries(item)[0];
    return { find, replacement };
  }));

  config.resolve.alias = alias;
}

/** @type {import('./types').ModifyOptimizeDeps} */
function modifyOptimizeDeps(config, exclude) {
  if (!config.optimizeDeps) config.optimizeDeps = {};
  if (!config.optimizeDeps.exclude) config.optimizeDeps.exclude = [];

  config.optimizeDeps.exclude.push(...exclude);
}

/** @type {import('./types').ModifyRollupExternal} */
function modifyRollupExternal(config) {
  if (!config.build) config.build = {};
  if (!config.build.rollupOptions) config.build.rollupOptions = {};
  if (!config.build.rollupOptions.external) config.build.rollupOptions.external = [];

  let external = config.build.rollupOptions.external;
  if (Array.isArray(external)) {
    external = ['electron', ...builtinModules, ...external];
  } else if (external instanceof RegExp) {
    external = ['electron', ...builtinModules, external];
  } else if (typeof external === 'string') {
    external = ['electron', ...builtinModules, external];
  } else if (typeof external === 'function') {
    const fn = external;
    external = (source, importer, isResolved) => {
      if (source === 'electron' || builtinModules.includes(source)) {
        return true;
      }
      return fn.call(fn, source, importer, isResolved);
    }
  }

  config.build.rollupOptions.external = external;
}

/** @type {import('./types').ModifyOptionsForElectron} */
function modifyOptionsForElectron(config) {
  // electron use `loadFile` load Renderer-process file
  if (!config.base) config.base = './';

  if (!config.build) config.build = {};

  // ensure `require('file-paht')` corre
  if (!config.build.assetsDir) config.build.assetsDir = '';

  if (!config.build.rollupOptions) config.build.rollupOptions = {};
  if (!config.build.rollupOptions.output) config.build.rollupOptions.output = {};
  if (Array.isArray(config.build.rollupOptions.output)) {
    config.build.rollupOptions.output.forEach(output => {
      if (!output.format) {
        // the packaged "electron app" should use "cjs"
        output.format = 'cjs';
      }
    });
  } else {
    if (!config.build.rollupOptions.output.format) {
      // the packaged "electron app" should use "cjs"
      config.build.rollupOptions.output.format = 'cjs';
    }
  }
}