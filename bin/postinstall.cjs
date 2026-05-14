#!/usr/bin/env node
/**
 * Post-install script for lark-for-claude.
 * Creates platform-appropriate launcher scripts in ~/.local/bin/.
 */
const { mkdirSync, writeFileSync, existsSync } = require('fs')
const { join } = require('path')
const { homedir } = require('os')

const isWin = process.platform === 'win32'
const binDir = join(homedir(), '.local', 'bin')
mkdirSync(binDir, { recursive: true })

if (isWin) {
  const target = join(binDir, 'claude-feishu.cmd')
  if (!existsSync(target)) {
    writeFileSync(target, '@echo off\r\nset CLAUDE_PROJECT_DIR=%cd%\r\nclaude --dangerously-load-development-channels plugin:feishu@feishu-local %*\r\n')
  }
} else {
  const target = join(binDir, 'claude-feishu')
  if (!existsSync(target)) {
    writeFileSync(target, '#!/bin/bash\nexec claude --dangerously-load-development-channels plugin:feishu@feishu-local "$@"\n')
  }
}
