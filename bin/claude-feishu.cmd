@echo off
rem Launch Claude Code with Feishu channel, or run management commands.
if "%1"=="auth" goto cli
if "%1"=="access" goto cli
set CLAUDE_PROJECT_DIR=%cd%
claude --dangerously-load-development-channels plugin:feishu@feishu-local %*
exit /b

:cli
bun "%~dp0cli.ts" %*
