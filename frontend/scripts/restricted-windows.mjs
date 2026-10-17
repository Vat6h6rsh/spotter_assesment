/** Optional QA preload for this workspace's Windows sandbox, NOT an application dependency.
 * Vite's optional `net use` probe assumes exec reports errors asynchronously. Node can
 * throw EPERM synchronously when pipe creation is restricted. Report that same error
 * through its callback; Vite then uses its existing fs.realpath fallback.
 * No permission is changed and no alternate process is started.
 */
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const temporary = resolve(import.meta.dirname, '../node_modules/.cache/qa-temp')
mkdirSync(temporary, { recursive: true })
process.env.TMP = temporary
process.env.TEMP = temporary
process.env.TMPDIR = temporary
if (process.platform === 'win32') {
  const original = childProcess.exec
  childProcess.exec = function (command, ...args) {
    try { return original.call(this, command, ...args) }
    catch (error) {
      if (command !== 'net use' || error.code !== 'EPERM') throw error
      const callback = args.findLast(value => typeof value === 'function')
      queueMicrotask(() => callback?.(error, '', ''))
    }
  }
  syncBuiltinESMExports()
}
