# ProofNote Frontend B — Wallet & Contract Layer

本目录是前端 B 给前端 A 的可接入交付物，依据 `ProofNote_MVP_API_SPEC_V1.0.md` 实现。

## 已完成

- EIP-1193 钱包连接与账户监听；
- 从 `GET /config` 读取 Monad 网络、RPC、Explorer 与合约地址；
- Monad 网络检测、切换与首次添加；
- `createStream`、`pauseStream`、`resumeStream`、`stopAndSettle`；
- `withdraw`、Stream 查询、Creator Incoming Streams 与 Claimable 查询；
- `PREPARING → WAITING_WALLET → SUBMITTED → CONFIRMED / FAILED` 状态机；
- RPC Gas 估算并增加 20% 安全余量，不写死超大 Gas Limit；
- Tx Hash 与 Explorer URL；
- BigInt 金额转换，禁止 JS 小数参与链上金额计算；
- Active Stream 本地平滑增长与链上快照校准；
- 钱包拒签、余额不足、合约 Revert、RPC 故障和确认超时的可读错误；
- Node 自动测试。

## 文件

```text
src/proofnote-web3.mjs       Web3 核心模块
src/proofnote-web3.d.ts      TypeScript 类型声明
src/frontend-a-adapter.mjs   前端 A 的最小调用层
contracts/StreamSupport.abi.json
tests/proofnote-web3.test.mjs
```

## 前端 A 的正确调用接口

最终 API 文档与截图中的临时签名存在一个区别：创建 Stream 不能只传 `creator`。

前端应传业务 `noteId`，由后端校验 Note、Creator、noteKey 和 Stream 开关，再返回已经编码好的 `TxRequest`：

```js
createStream(noteId, rateMonPerSecond, budgetMon)
pauseStream(streamId)
resumeStream(streamId)
stopAndSettle(streamId)
```

这样可以防止前端传错 Creator，也不需要 UI 层自行编码 calldata。

## 最小接入示例

```js
import { createFrontendBActions } from "./src/frontend-a-adapter.mjs";

const web3 = createFrontendBActions({
  apiBaseUrl: "/api/v1",
  getAccessToken: () => sessionStorage.getItem("proofnote_access_token"),

  onTransactionProgress(event) {
    // event.state:
    // PREPARING / WAITING_WALLET / SUBMITTED / CONFIRMED / FAILED
    transactionProgress.render(event);

    if (event.state === "SUBMITTED") {
      explorerLink.href = event.explorerUrl;
      explorerLink.textContent = `Tx ${event.txHash.slice(0, 10)}…`;
    }
  },

  onStreamDisplay(stream) {
    amountNode.textContent = `${stream.accruedFormatted} MON`;
    remainingNode.textContent = `${stream.remainingFormatted} MON`;
    endNode.textContent = stream.estimatedEndSeconds == null
      ? stream.status
      : `${stream.estimatedEndSeconds}s`;
  },
});

await web3.initialize();
await web3.connectWallet();

startButton.onclick = async () => {
  await web3.createStream("note_01", "0.001", "0.2000");
  // StreamCreated 被 Indexer 收录后，用真实 streamId 调用：
  // await web3.resyncStream(streamId);
};

pauseButton.onclick = () => web3.pauseStream(streamId);
resumeButton.onclick = () => web3.resumeStream(streamId);
settleButton.onclick = () => web3.stopAndSettle(streamId);
```

## UI 状态映射

| Web3 状态 | TransactionProgress 文案 | UI 操作 |
|---|---|---|
| `PREPARING` | 准备交易参数 | 禁用重复提交 |
| `WAITING_WALLET` | 等待钱包确认 | 引导用户查看钱包 |
| `SUBMITTED` | 交易已提交 | 显示 Tx Hash 与 Explorer |
| `CONFIRMED` | 已在 Monad 确认 | 刷新 Stream / Profile 数据 |
| `FAILED` | 使用 `error.message` | 恢复按钮，可重试 |

绿色只用于 `CONFIRMED`，`ACTIVE` 应使用淡紫色或墨黑状态色。

## 与 A / 后端的联调约定

前端 A 需要提供：

- TransactionProgress 的渲染函数；
- Active / Paused / Settled UI 状态；
- 当前 `noteId` 与后端返回的真实 `streamId`；
- 交易确认后刷新 Note、Stream 与 Creator Profile 的回调。

后端 / 合约需要提供：

- 可访问的 `GET /api/v1/config`；
- `/streams/*/prepare` 系列接口；
- 已部署的 `streamSupport` 地址；
- 与本目录 ABI 一致的合约版本；
- Indexer 能从 `StreamCreated` 返回新 Stream 的业务读模型。

本模块不会写死：Chain ID、RPC、Explorer、合约地址或协议费率。协议费用必须来自后端 quote 或链上 preview。

## 演示参数建议

路演完整路径约 90 秒。`0.001 MON/s + 0.0200 MON` 只能持续 20 秒，容易在讲解中耗尽。

建议 Demo 使用：

```text
Rate        0.001 MON/s
Max Budget  0.2000 MON
```

这样最长约 200 秒，足够完成 Start、Pause、Resume、Stop & Settle。

## 本地检查

```text
npm run check
npm test
```
