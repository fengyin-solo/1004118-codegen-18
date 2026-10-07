// 用本地 typescript 转译并加 @/ 别名解析，直接跑 .ts 验证脚本（环境里的 esbuild 二进制与架构不匹配）。
const path = require('path')
const Module = require('module')
const ts = require('typescript')

const srcDir = path.resolve(__dirname, '..', 'src')

const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) {
    const candidate = path.join(srcDir, request.slice(2))
    try {
      return originalResolve.call(this, candidate, ...rest)
    } catch {
      return originalResolve.call(this, candidate + '.ts', ...rest)
    }
  }
  return originalResolve.call(this, request, ...rest)
}

require.extensions['.ts'] = function (module, filename) {
  const source = require('fs').readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  module._compile(output.outputText, filename)
}

require(path.resolve(__dirname, 'verify-maintenance.ts'))
