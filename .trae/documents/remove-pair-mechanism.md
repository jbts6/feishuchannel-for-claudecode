# 移除 Pair 配对机制

## 目标

从根源上移除所有 pair 配对相关代码，只保留通过本地 `access.json` 管理权限的方式。这消除了通过飞书消息批准访问的可能性（prompt injection 风险），实现真正的隐私保护。

## 需要移除的功能

1. **`dmPolicy: 'pairing'`** — 整个 pairing 模式
2. **`PendingEntry`** **类型** — pending 条目类型
3. **`pending`** **字段** — Access 中的 pending 存储
4. **`gate()`** **中的 pair 逻辑** — 生成配对码、重发配对码
5. **`pruneExpired()`** — 清理过期 pending 条目
6. **`APPROVED_DIR`** **+** **`checkApprovals()`** — 审批目录和轮询
7. **CLI** **`pair`** **/** **`deny`** **子命令** — 配对和拒绝配对码
8. **CLI** **`policy`** **中的** **`pairing`** **选项** — 只保留 `allowlist` / `disabled`
9. **router.ts 中的 pair 回复** — 配对提示消息
10. **server.ts 中的 pair 回复** — 配对提示消息
11. **`GateResult`** **中的** **`pair`** **分支** — gate 返回类型

## 需要保留的功能

* `dmPolicy: 'allowlist'` — 只允许 allowFrom 中的用户

* `dmPolicy: 'disabled'` — 拒绝所有 DM

* `allowFrom` — 通过 CLI `allow <id>` 管理

* `groups` — 群组权限管理

* `pendingPerms` / `pendingConfirms` — 这些是 Claude 权限请求/确认码，不是 pair 配对，保留

## 实施步骤

### Step 1: shared.ts — 类型修改

1. 移除 `PendingEntry` 类型
2. `Access.dmPolicy` 类型改为 `'allowlist' | 'disabled'`
3. 移除 `Access.pending` 字段
4. `defAccess()` 默认 `dmPolicy: 'allowlist'`，移除 `pending: {}`
5. `readAccess()` 移除 `pending` 解析，`dmPolicy` 默认 `'allowlist'`
6. 移除 `pruneExpired()` 函数
7. `GateResult` 移除 `pair` 分支
8. `gate()` 函数：移除所有 pending/pair 逻辑，未知用户直接 drop
9. 移除 `genConfirmCode()` — 不，这个仍被 `pendingConfirms` 使用，保留

### Step 2: server.ts — 移除 pair 相关

1. 移除 `APPROVED_DIR` 常量
2. 移除 `checkApprovals()` 函数和 `setInterval(checkApprovals, 5000)`
3. 移除 `handleInbound` 中 `result.action === 'pair'` 分支
4. 移除 static mode 中的 pairing downgrade 逻辑（不再需要）
5. 注释更新

### Step 3: router.ts — 移除 pair 相关

1. 移除 `handleInbound` 中 `result.action === 'pair'` 分支

### Step 4: bin/cli.ts — 移除 pair/deny 子命令

1. 移除 `APPROVED_DIR` 常量
2. 移除 `pair` 子命令处理
3. 移除 `deny` 子命令处理
4. `policy` 子命令只接受 `allowlist` / `disabled`
5. `handleAuth` 中移除 Pending 显示
6. `showAccessFull` 中移除 Pending 显示
7. 更新 usage 提示

### Step 5: server.test.ts — 更新测试

1. 移除 `pending user gets resend` 测试
2. 移除 `pending user with 2+ replies gets dropped` 测试
3. 移除 `too many pending drops new users` 测试
4. 移除 `unknown user in pairing mode gets code` 测试
5. 修改 `unknown user in allowlist mode drops` 测试为默认行为
6. 移除 `pruneExpired` 测试
7. 移除 `PendingEntry` 导入
8. 更新 `defAccess` 相关断言（dmPolicy 默认值）

### Step 6: 验证

```bash
bunx tsc --noEmit
bun test
```

