# ProofNote Frontend

ProofNote 的半天 Hackathon Demo 前端，已合并：

- A：Note、Support、Impact、Profile、Open Ledger UI 与交易状态；
- B：EIP-1193 钱包、Monad 网络、`/prepare` API、合约交易、BigInt 金额和 Stream 快照；
- Bridge：真实 API 可用时启用 Web3；本地无后端时自动保留 Mock 演示。

## 运行

```bash
npm run check
npm test
npm run dev
```

打开 `http://127.0.0.1:4173/`。

本项目没有第三方运行依赖，Node.js 18+ 即可。

## 目录

```text
index.html                         UI 与状态机
proofnote-web3-adapter.js          Mock Adapter
proofnote-web3-real-bridge.mjs     A/B 接口桥接与真实/Mock 降级
src/proofnote-web3.mjs             钱包与合约核心
src/frontend-a-adapter.mjs         B 的最小 Actions 层
src/proofnote-web3.d.ts            类型声明
contracts/StreamSupport.abi.json   合约 ABI
tests/proofnote-web3.test.mjs      自动测试
WEB3_INTEGRATION.md                B 的接口说明
```

## 运行模式

页面始终先加载 Mock Adapter。默认地址用于稳定演示：

```text
http://127.0.0.1:4173/
```

后端接口就绪后使用真实模式：

```text
http://127.0.0.1:4173/?web3=real
```

`proofnote-web3-real-bridge.mjs` 会：

1. 请求 `GET /api/v1/config`；
2. 读取 EIP-1193 钱包会话；
3. 初始化成功后调用 `ProofNoteUI.useAdapter(realAdapter)`；
4. 初始化失败则继续使用 Mock，保证路演页面仍可操作。

浏览器控制台可查看：

```js
window.ProofNoteWeb3Status
window.ProofNoteUI.getDemoState()
```

## 后端接口依赖

真实 Stream 主链路需要：

```text
GET  /api/v1/config
POST /api/v1/notes/:noteId/streams/prepare
POST /api/v1/streams/:streamId/pause/prepare
POST /api/v1/streams/:streamId/resume/prepare
POST /api/v1/streams/:streamId/stop/prepare
POST /api/v1/streams/withdraw/prepare
GET  /api/v1/streams/:streamId
```

API 响应格式和钱包行为见 `WEB3_INTEGRATION.md`。

## Demo 参数

```text
Rate        0.001 MON/s
Max Budget  0.2000 MON
```

约可持续 200 秒，适合完成 Start、Pause、Resume、Stop & Settle 和领取演示。

## 当前真实与 Mock 边界

真实 Web3：钱包、创建 Stream、暂停、恢复、停止结算、领取收入、Stream 查询。

继续 Mock：发布 Note、Direct Tip、Impact Attestation。对应 `/prepare` API 就绪后可按同一 Adapter 模式接入。
