# MongoDB MCP Server（支持 MongoDB 3.x 旧版）

> 本文档是针对本 fork 的**中文使用说明**。原版项目请参考 [README.md](./README.md)。

## 📌 这个项目是什么

这是 [mongodb-js/mongodb-mcp-server](https://github.com/mongodb-js/mongodb-mcp-server) 的 fork，**新增了对 MongoDB 3.x（3.0 ~ 3.6）旧版本的支持**。

原版 MCP Server 依赖 `mongodb` driver v7，要求 MongoDB **4.2 或更高版本**（wire protocol 版本 ≥ 8）。如果你连的是 3.4 这种老数据库，会在连接握手阶段直接报错：

```
Server reports maximum wire version 5, but this version of the Node.js Driver requires at least 8 (MongoDB 4.2)
```

本 fork 通过引入 `--legacyDriver` 模式解决了这个问题。

---

## ⚠️ 重要：使用前必读（避免下载错 MCP）

### 1. 必须使用本 fork，不能用原版

| | 原版 `mongodb-mcp-server` | **本 fork** |
|---|---|---|
| npm 包名 | `mongodb-mcp-server` | `@mkmindone/mongodb-mcp-server` |
| 支持的 MongoDB | 4.2+ | 3.0 ~ 最新 |
| 关键参数 | 无 | `--legacyDriver` |
| 适用场景 | 新版 MongoDB | **旧版 MongoDB 3.x** |

**❌ 错误做法**（会连不上 3.4 数据库）：
```json
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server"],   // ← 这是官方原版，不支持 3.x！
      "env": { "MDB_MCP_CONNECTION_STRING": "mongodb://..." }
    }
  }
}
```

**✅ 正确做法**（用本 fork 从 npm 安装）：
```json
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": ["-y", "@mkmindone/mongodb-mcp-server", "--legacyDriver", "--readOnly"],
      "env": { "MDB_MCP_CONNECTION_STRING": "mongodb://..." }
    }
  }
}
```

### 2. 必须加 `--legacyDriver` 参数

连旧版 MongoDB 时，**缺少这个参数会连接失败**。它让 MCP Server 内部改用 `mongodb@3.7` driver（兼容旧版 wire protocol）。

### 3. 必须加 `--readOnly` 参数

legacy 模式目前**只实现了查询功能**（find / aggregate / count / list 等），写操作（insert / update / delete）未实现。加 `--readOnly` 可以确保写工具不被注册，避免误调用报错。

### 4. 密码特殊字符要 URL 编码

如果密码里含 `@`、`:`、`/` 等特殊字符，必须在连接串里做 URL 编码：

| 原始字符 | 编码后 |
|---|---|
| `@` | `%40` |
| `:` | `%3A` |
| `/` | `%2F` |
| `#` | `%23` |

例如密码 `zwkj@123`，连接串里要写成 `zwkj%40123`。

### 5. `authSource` 要写对

如果连接认证失败（`Authentication failed`），很可能是 `authSource` 不对。你的用户建在哪个库下，`authSource` 就填哪个：

```
# 用户 admin 建在 admin 库下
mongodb://admin:zwkj%40123@host:port/et?authSource=admin
```

---

## 🚀 在各客户端中使用

### 前置准备（二选一）

**方式 A：直接从 npm 安装运行**（推荐，最简单）

```bash
npx -y @mkmindone/mongodb-mcp-server --legacyDriver --readOnly
```

无需本地构建，`npx` 会自动从 npm 拉取并运行。

**方式 B：本地克隆构建**

```bash
git clone -b feat/mongodb-3.4-support https://github.com/daijinhai/mongodb-mcp-server.git
cd mongodb-mcp-server
pnpm install && pnpm run build
# 构建产物在 dist/esm/index.js
```

### Cursor

打开 **Settings → Cursor Settings → Features → MCP**，点 **+ Add MCP Server**，粘贴：

```json
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": ["-y", "@mkmindone/mongodb-mcp-server", "--legacyDriver", "--readOnly"],
      "env": {
        "MDB_MCP_CONNECTION_STRING": "mongodb://admin:zwkj%40123@111.15.180.153:28018/et?authSource=admin"
      }
    }
  }
}
```

如果你是本地构建的，改成：
```json
{
  "mcpServers": {
    "mongodb": {
      "command": "node",
      "args": ["/你的路径/mongodb-mcp-server/dist/esm/index.js", "--legacyDriver", "--readOnly"],
      "env": {
        "MDB_MCP_CONNECTION_STRING": "mongodb://admin:zwkj%40123@111.15.180.153:28018/et?authSource=admin"
      }
    }
  }
}
```

### Claude Code（CLI）

编辑 `~/.claude.json`：

```json
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": ["-y", "@mkmindone/mongodb-mcp-server", "--legacyDriver", "--readOnly"],
      "env": {
        "MDB_MCP_CONNECTION_STRING": "mongodb://admin:zwkj%40123@111.15.180.153:28018/et?authSource=admin"
      }
    }
  }
}
```

启动后用 `/mcp` 命令查看连接状态。

### Codex

编辑 `~/.codex/config.toml`：

```toml
[mcp_servers.mongodb]
command = "npx"
args = ["-y", "@mkmindone/mongodb-mcp-server", "--legacyDriver", "--readOnly"]

[mcp_servers.mongodb.env]
MDB_MCP_CONNECTION_STRING = "mongodb://admin:zwkj%40123@111.15.180.153:28018/et?authSource=admin"
```

---

## 🔧 配置参数说明

| 参数 / 环境变量 | 默认值 | 说明 |
|---|---|---|
| `--legacyDriver` / `MDB_MCP_LEGACY_DRIVER` | `false` | **核心开关**。启用后用 `mongodb@3.7` driver 连接，支持 MongoDB 3.x。连旧版数据库时**必加**。 |
| `--readOnly` / `MDB_MCP_READ_ONLY` | `false` | 只读模式。只注册查询和元数据工具，屏蔽所有写操作。legacy 模式下**建议必加**。 |
| `MDB_MCP_CONNECTION_STRING` | 无 | MongoDB 连接串。密码特殊字符需 URL 编码。 |
| `MDB_MCP_TRANSPORT` / `--transport` | `stdio` | 传输方式：`stdio`（CLI 客户端用）或 `http`。 |
| `MDB_MCP_LOGGERS` / `--loggers` | `disk,mcp` | 日志输出方式。调试时可加 `stderr`。 |
| `MDB_MCP_MAX_TIME_MS` / `--maxTimeMS` | 无 | 查询超时时间（毫秒）。大表查询慢时可以调大。 |

---

## ✅ 已验证的功能

针对 **MongoDB 3.4.24**（`111.15.180.153:28018/et`）实测通过：

| 工具 | 状态 | 说明 |
|---|---|---|
| `find` | ✅ | 正常查询，返回真实文档，ObjectId 正确转换 |
| `aggregate` | ✅ | 支持 `$match`、`$group`、`$limit`、`$sort` 等阶段 |
| `count` | ✅ | 统计文档数（6567 万条表测试通过） |
| `list-databases` | ✅ | 列出所有数据库 |
| `list-collections` | ✅ | 列出指定库的集合 |
| `collection-indexes` | ✅ | 列出集合的索引 |
| `collection-schema` | ✅ | 采样推断集合字段结构 |
| `db-stats` | ✅ | 数据库统计信息 |
| `explain` | ✅ | 查询执行计划 |

> ⚠️ 以下功能在 MongoDB 3.x 上**不可用**（受数据库版本限制，非 MCP 问题）：
> - Atlas Search（`$search`、`$vectorSearch`）
> - Change Stream（`$changeStream`，需 4.0+ 副本集）
> - 所有写操作（insert/update/delete/create/drop）——legacy 模式未实现

---

## 🧪 如何自己测试

```bash
# 1. 克隆并构建
git clone -b feat/mongodb-3.4-support https://github.com/daijinhai/mongodb-mcp-server.git
cd mongodb-mcp-server
pnpm install && pnpm run build

# 2. 启动 server（stdio 模式）
MDB_MCP_CONNECTION_STRING="mongodb://admin:zwkj%40123@111.15.180.153:28018/et?authSource=admin" \
MDB_MCP_LEGACY_DRIVER=true \
MDB_MCP_READ_ONLY=true \
node dist/esm/index.js --transport stdio

# 3. 用 MCP Inspector 交互测试（推荐）
npx @modelcontextprotocol/inspector node dist/esm/index.js --legacyDriver --readOnly
```

---

## ❓ 常见问题

### Q: 连接报 "Authentication failed"
**A:** 检查 `authSource` 参数。你的用户建在哪个库下就填哪个（通常是 `admin`）。

### Q: 连接报 wire version 错误
**A:** 你忘加 `--legacyDriver` 参数了。

### Q: find 查询很慢或超时
**A:** 大表（千万级以上）的 `countDocuments` 统计较慢。可以：
- 设置 `MDB_MCP_MAX_TIME_MS=120000`（2 分钟超时）
- 或在 aggregate 里用 `$match` + `$limit` 替代全表 find

### Q: 报 "BSONVersionError"
**A:** 这是 driver 版本冲突问题，本 fork 已修复。确保你用的是 `feat/mongodb-3.4-support` 分支的最新代码。

### Q: 能支持写操作吗？
**A:** 当前 legacy 模式只实现了只读查询。写操作需要额外在 LegacyServiceProvider 里实现 insert/update/delete 等方法，技术上可行但需要开发。

---

## 📂 技术实现概要

核心改动：

```
src/common/serviceProvider.ts       # 新增：MongoDbServiceProvider 接口（解耦工具和 driver）
src/common/legacyServiceProvider.ts # 新增：LegacyServiceProvider 适配器（mongodb@3.7）
src/types/mongodb-3.d.ts            # 新增：类型声明（mongodb@3 / bson@1 无自带类型）
src/common/connectionManager.ts     # 修改：按 legacyDriver 开关路由连接方式
src/common/session.ts               # 修改：serviceProvider 类型改用新接口
src/tools/mongodb/mongodbTool.ts    # 修改：ensureConnected 返回类型改用新接口
src/common/config/userConfig.ts     # 修改：新增 legacyDriver 配置项
```

关键技术点：
1. **双 driver 共存**：通过 npm 别名同时安装 `mongodb@7`（原版用）和 `mongodb@3.7`（legacy 用），互不冲突。
2. **BSON 跨版本转换**：v3 driver 返回的 bson@1 对象，通过二进制中转（bson@1 serialize → bson@7 deserialize）转成 v7 格式，避免版本冲突。
3. **cursor 适配**：v3 的 cursor 没有 `tryNext()` 方法，适配器里用 `hasNext()/next()` 模拟实现。

分支：`feat/mongodb-3.4-support`
