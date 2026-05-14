@echo off
rem Launch Claude Code with Feishu channel (Windows)
set CLAUDE_PROJECT_DIR=%cd%
claude --dangerously-load-development-channels plugin:feishu@feishu-local %*
