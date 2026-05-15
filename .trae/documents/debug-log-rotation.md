# debug.log 日志轮转优化方案

## 问题分析

当前 `makeDebugger` 使用 `appendFileSync` 无限追加写入日志，没有任何大小限制或轮转机制。长期运行后 `debug.log` 和 `router-debug.log` 会无限增长，占用磁盘空间且难以查阅。

## 设计方案：内置日志轮转

在 `makeDebugger` 中加入轻量级日志轮转，不引入外部依赖。

### 核心参数

| 参数 | 值 | 说明 |
|---|---|---|
| `MAX_LOG_SIZE` | 5 MB | 单个日志文件最大大小 |
| `MAX_LOG_FILES` | 3 | 保留的轮转文件数量（含当前文件） |
| 轮转命名 | `debug.log` → `debug.log.1` → `debug.log.2` | 数字递增，数字越大越旧 |

### 轮转策略

1. **写入前检查**：每次写入时检查当前日志文件大小
2. **惰性检查**：不每次都 stat，用内存计数器间隔检查（每 100 次写入检查一次文件大小）
3. **轮转操作**：
   - 删除最老的文件（`debug.log.2`）
   - `debug.log.1` → `debug.log.2`
   - `debug.log` → `debug.log.1`
   - 创建新的 `debug.log`
4. **启动时清理**：进程启动时检查日志文件大小，如果超限立即轮转

### 为什么不用外部工具

- logrotate（Linux only，Windows 不支持）
- winston/pino（过重，本项目只需简单调试日志）
- 项目本身是轻量级 MCP channel，应保持零重依赖

## 实现步骤

### Step 1: 在 shared.ts 中添加日志轮转常量

在 `MAX_CHUNK` 附近添加：

```ts
export const MAX_LOG_SIZE = 5 * 1024 * 1024
export const MAX_LOG_FILES = 3
export const LOG_ROTATE_CHECK_INTERVAL = 100
```

### Step 2: 在 shared.ts 中添加 `rotateLogIfNeeded` 函数

```ts
function rotateLogIfNeeded(logFile: string) {
  try {
    const size = statSync(logFile).size
    if (size < MAX_LOG_SIZE) return
    for (let i = MAX_LOG_FILES - 2; i >= 1; i--) {
      const older = `${logFile}.${i}`
      const newer = `${logFile}.${i - 1 || ''}`.replace(/\.$/, '')
      // 实际逻辑：删除最老的，依次重命名
    }
    // 具体实现：从大到小编号依次重命名
    for (let i = MAX_LOG_FILES - 2; i >= 1; i--) {
      const oldPath = `${logFile}.${i}`
      if (existsSync(oldPath)) {
        if (i === MAX_LOG_FILES - 1) rmSync(oldPath, { force: true })
        else renameSync(oldPath, `${logFile}.${i + 1}`)
      }
    }
    renameSync(logFile, `${logFile}.1`)
  } catch { /* 文件不存在或无法访问，忽略 */ }
}
```

### Step 3: 修改 `makeDebugger` 加入轮转逻辑

```ts
export function makeDebugger(logFile: string, prefix = '') {
  let writeCount = 0
  rotateLogIfNeeded(logFile)  // 启动时检查
  return (msg: string) => {
    const line = `${new Date().toISOString()} ${prefix}${msg}\n`
    process.stderr.write(line)
    try {
      appendFileSync(logFile, line)
      writeCount++
      if (writeCount % LOG_ROTATE_CHECK_INTERVAL === 0) rotateLogIfNeeded(logFile)
    } catch (e) { process.stderr.write(`debug log write failed: ${e}\n`) }
  }
}
```

### Step 4: 需要额外导入的 fs 函数

shared.ts 已有 `statSync`、`renameSync`、`existsSync`、`rmSync`，无需新增导入。

### Step 5: 运行测试验证

```bash
bun test
bunx tsc --noEmit
```

## 风险评估

- **低风险**：轮转操作只在日志超限时触发，正常使用不受影响
- **原子性**：`renameSync` 在同一文件系统上是原子的，不会丢失日志
- **性能**：每 100 次写入才做一次 stat 检查，开销可忽略
