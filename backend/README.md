# ProofNote Backend

Monad 测试网上的 ProofNote 后端：Fastify API + Indexer worker + 共享包 monorepo。

设计文档：`../ProofNote_BACKEND_DEVELOPMENT_V1.0.md` · 接口规范：`../ProofNote_MVP_API_SPEC_V1.0.md`

## 结构

```
apps/api        HTTP API（Fastify，13 个模块）
apps/indexer    链上事件订阅 worker（getLogs 轮询 + 断点续扫）
contracts/      链上合约（Foundry 工程 + 本地 EVM 验证工具链，见 contracts/README.md）
packages/       api-types / hash-utils / chain-config / contract-abis / db
```

## 快速开始

```bash
# 0) 安装依赖（pnpm；没有 pnpm 时可 npx pnpm@9 install）
pnpm install

# 1) 准备 Postgres（任选其一）
docker run -d --name proofnote-pg -e POSTGRES_USER=proofnote \
  -e POSTGRES_PASSWORD=proofnote -e POSTGRES_DB=proofnote -p 5432:5432 postgres:16
# 无 Docker 时可用嵌入式 PG（npm 分发二进制，另开终端运行）：
pnpm dev:pg
# 或使用任意现有实例，改写 .env 中的 DATABASE_URL

# 2) 配置环境
cp .env.example .env       # 默认本地开发即可跑（MOCK_CHAIN 自动启用）

# 3) 建表
pnpm db:push

# 4) 启动
pnpm dev:api               # API  http://localhost:8080/api/v1
pnpm dev:indexer           # 事件索引（接真实合约后启用）

# 5) 冒烟（进程内跑通 SPEC §65 闭环）
pnpm smoke
```

## 两种运行模式

- **MOCK_CHAIN（默认）**：未配置合约地址时自动启用。`*/prepare` 返回占位 TxRequest，
  `/transactions/track` 与 `confirm-anchor` 直接写读模型模拟链上确认——前端无需等合约即可全流程联调，
  也可作为演示容灾预案。
- **真实链模式**：在 `.env` 回填 6 个合约地址后自动切换，所有状态推进改为
  「receipt 验证 + Indexer 事件」驱动，链上为唯一事实源。

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm typecheck` | 全仓 TypeScript 检查 |
| `pnpm test` | hash-utils 固定向量测试 |
| `pnpm db:push` | Drizzle schema 推送到数据库 |
| `pnpm dev:pg` | 启动嵌入式 Postgres（免 Docker，数据在 ./data/embedded-pg） |
| `pnpm smoke` | 端到端冒烟（需 Postgres，49 组断言覆盖 SPEC §65 闭环） |

> 网络：本机 npmmirror/npmjs 不可达时 `.npmrc` 已指向腾讯镜像，可按需改回。
> 智能体调试：`SMOKE_DEBUG=1 pnpm smoke` 会打开错误日志。

## 注意

- 本目录内开发；`frontend_xw/` 为前端工作区，后端勿动。
- 生产部署：`pnpm start:api` / `pnpm start:indexer`（tsx 直跑 TS 源，比赛口径；构建链后续补）。
- 密钥只放 `.env`（已 gitignore）；Deployer 私钥不属于本服务，勿配置。
