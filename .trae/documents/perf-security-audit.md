# 性能和安全问题审查

## 安全问题

### S1. 🔴 命令注入 — `findChannelAncestorPid` (server.ts:43)

```ts
execSync(`wmic process where processid=${pid} get parentprocessid,commandline /value`)
```

`pid` 来自 `process.ppid`，理论上安全（数字），但 `commandline` 输出被直接用于日志和正则匹配，无消毒。如果进程命令行包含恶意内容（如用户控制的目录名），可能被注入到日志或后续处理中。

**修复**：验证 `pid` 为正整数，对输出做 sanitize。

### S2. 🔴 命令注入 — `getProcessCwd` (server.ts:86)

```ts
execSync(`lsof -a -p ${pid} -d cwd -Fn`)
```

同上，`pid` 来自 `CHANNEL_ANCESTOR_PID`，虽然来源可控，但最好加验证。

**修复**：加 `if (!/^\d+$/.test(String(pid))) return undefined` 守卫。

### S3. 🟡 正则注入 — `checkMention` (shared.ts:270)

```ts
new RegExp(p, 'i').test(text)
```

`mentionPatterns` 来自 `access.json`，如果用户通过 CLI 注入恶意正则（如 ReDoS 攻击模式），可能导致 CPU 拒绝服务。当前已有 try-catch 防崩溃，但未防 ReDoS。

**修复**：加正则复杂度限制或超时保护。

### S4. 🟡 正则注入 — CLI `auth key` (bin/cli.ts:61)

```ts
const re = new RegExp(`^${key}=.*$`, 'm')
```

`key` 来自命令行参数，如果包含正则特殊字符（如 `.*`），可能匹配到非预期行。

**修复**：对 `key` 做 `escapeRegExp` 处理。

### S5. 🟡 敏感信息泄露 — `handleCardAction` (server.ts:464)

```ts
dbg(`handleCardAction: ${JSON.stringify(data).slice(0, 500)}`)
```

卡片回调数据可能包含用户信息（open\_id 等），被写入 debug.log。日志文件权限为 0o600，但仍有泄露风险。

**修复**：脱敏处理 open\_id 等字段。

### S6. 🟡 敏感信息泄露 — `handleInbound` (server.ts:547)

```ts
dbg(`handleInbound: sender=${JSON.stringify(sender?.sender_id)}, chat_id=${message?.chat_id}...`)
```

同上，用户 ID 和 chat ID 被写入日志。

### S7. 🟡 `.env` 文件权限 — `handleAuth` (bin/cli.ts:65, 77)

```ts
writeFileSync(ENV_FILE, content)
```

CLI 写入 `.env` 时未设置文件权限（默认可能是 0644），而 `loadEnv` 会 `chmodSync(envFile, 0o600)`。但 CLI 端未同步设置。

**修复**：在 CLI 写入后也设置 `chmodSync(ENV_FILE, 0o600)`。

### S8. 🟡 `pendingConfirms` 无过期清理 (server.ts:242)

```ts
const pendingConfirms = new Map<string, { chatId: string; senderId: string; title: string; content: string }>()
```

确认码存入 Map 后，如果用户从未响应，条目永远不会被清理，可能导致内存缓慢增长。

**修复**：加 TTL 过期清理（如 1 小时后自动删除）。

### S9. 🟡 `pendingPerms` 同理 (server.ts:241)

同 S8，权限请求的 pending 条目也无过期清理。

### S10. 🟢 确认码熵不足 — `genConfirmCode` (shared.ts:199)

```ts
const bytes = randomBytes(5)
return Array.from(bytes).map(b => CONFIRM_CHARS[b % CONFIRM_CHARS.length]).join('')
```

5 字节 = 40 bit 熵，25 个字符的字母表。实际熵 = 5 \* log2(25) ≈ 23.2 bit。对于确认码来说勉强够用，但如果攻击者能观察到确认码格式，暴力破解空间较小。

**修复**：增加到 8 字节（≈37 bit 熵）或使用更多字符。

## 性能问题

### P1. 🔴 同步文件 I/O 阻塞事件循环

整个项目大量使用 `readFileSync`、`writeFileSync`、`appendFileSync`、`statSync`、`existsSync` 等同步 I/O：

* `loadAccess()` → `readFileSync(ACCESS_FILE)` — 每条消息都会调用

* `makeDebugger` → `appendFileSync` — 每条日志都同步写入

* `rotateLogIfNeeded` → `statSync` + `renameSync` — 轮转时阻塞

* `saveAccess` → `writeFileSync` + `renameSync` — 每次权限变更

* `checkApprovals` → `readdirSync` + `readFileSync` — 每 5 秒轮询

在高消息频率下，这些同步 I/O 会阻塞 Node.js 事件循环，导致消息处理延迟。

**修复**：将热路径（`loadAccess`、`appendFileSync`）改为异步版本，或使用内存缓存减少 I/O 次数。

### P2. 🟡 `loadAccess` 每条消息读文件 — AccessCache 缓存不够

虽然 `AccessCache` 有 2 秒 TTL，但 `loadRouterAccess()` (router.ts:45) 每次都直接调用 `readAccess`（无缓存），不经过 `AccessCache`。

**修复**：router.ts 也使用 `AccessCache`。

### P3. 🟡 `appendFileSync` 每条日志同步写入

`makeDebugger` 每条日志都调用 `appendFileSync`，在高频消息场景下性能开销显著。

**修复**：改为缓冲写入（内存 buffer + 定时 flush），或使用 `writeStream`。

### P4. 🟡 `checkApprovals` 轮询效率低 (server.ts:185-202)

每 5 秒 `readdirSync` + 逐个 `readFileSync`，即使目录为空也会执行。

**修复**：使用 `fs.watch` 监听目录变更，或先检查目录是否存在。

### P5. 🟡 `findChannelAncestorPid` 启动时执行 `ps -ax` (server.ts:59)

`ps -ax` 在大型系统上可能返回数千行，`maxBuffer: 4MB` 虽然够用，但解析开销大。

**修复**：改用 `ps -o pid=,ppid=,args= -p <ppid_chain>` 只查询相关进程。

### P6. 🟢 `normalizePath` 每次调用 `realpathSync` (shared.ts:191)

`resolveChatId` 中对每个 group 的 workdir 都调用 `normalizePath`，而 `realpathSync` 涉及文件系统访问。

**修复**：缓存 `normalizePath` 结果，或只在启动时计算一次。

## 实施优先级

| 优先级 | 编号    | 描述                        | 工作量 |
| --- | ----- | ------------------------- | --- |
| P0  | S1+S2 | 命令注入防护（pid 验证）            | 小   |
| P0  | S7    | .env 文件权限                 | 小   |
| P0  | S8+S9 | pending Map 过期清理          | 中   |
| P1  | S4    | CLI key 正则转义              | 小   |
| P1  | P2    | router 使用 AccessCache     | 小   |
| P1  | P3    | 日志缓冲写入                    | 中   |
| P2  | S3    | mentionPatterns ReDoS 防护  | 小   |
| P2  | P4    | checkApprovals 优化         | 小   |
| P2  | P5    | findChannelAncestorPid 优化 | 中   |
| P3  | S5+S6 | 日志脱敏                      | 中   |
| P3  | S10   | 确认码熵增强                    | 小   |
| P3  | P6    | normalizePath 缓存          | 小   |

