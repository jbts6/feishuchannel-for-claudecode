#!/usr/bin/env node
/**
 * Post-install script for lark-for-claude.
 * Creates platform-appropriate launcher scripts in ~/.local/bin/
 * that delegate to the real scripts in the install directory.
 */
const { mkdirSync, writeFileSync, existsSync } = require('fs')
const { join } = require('path')
const { homedir } = require('os')

const binDir = join(homedir(), '.local', 'bin')
const installBinDir = join(__dirname)
mkdirSync(binDir, { recursive: true })

if (process.platform === 'win32') {
  const target = join(binDir, 'claude-feishu.cmd')
  if (!existsSync(target)) {
    const content = `@echo off\r\n"${installBinDir}\\claude-feishu.cmd" %*\r\n`
    writeFileSync(target, content)
  }
} else {
  const target = join(binDir, 'claude-feishu')
  if (!existsSync(target)) {
    writeFileSync(target, `#!/bin/bash\nexec "${installBinDir}/claude-feishu" "$@"\n`)
    try { require('fs').chmodSync(target, 0o755) } catch {}
  }
}
