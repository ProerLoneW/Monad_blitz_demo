import test from "node:test";
import assert from "node:assert/strict";
import {
  createStreamTicker,
  formatMon,
  normalizeWeb3Error,
  parseMon,
  ProofNoteWeb3Client,
  ProofNoteWeb3Error,
  WalletTxUiState,
} from "../src/proofnote-web3.mjs";
import { createFrontendBActions } from "../src/frontend-a-adapter.mjs";

const account = "0x2222222222222222222222222222222222222222";
const contract = "0x1111111111111111111111111111111111111111";
const txHash = `0x${"ab".repeat(32)}`;

function apiResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; },
  };
}

test("MON 金额始终用字符串和 bigint 转换", () => {
  assert.equal(parseMon("0.001"), 1_000_000_000_000_000n);
  assert.equal(parseMon("0.0200"), 20_000_000_000_000_000n);
  assert.equal(formatMon(7_000_000_000_000_000n), "0.007");
  assert.throws(() => parseMon(0.001), (error) => error instanceof ProofNoteWeb3Error && error.code === "INVALID_AMOUNT");
  assert.throws(() => parseMon("1e-3"), (error) => error instanceof ProofNoteWeb3Error && error.code === "INVALID_AMOUNT");
});

test("ACTIVE Stream 本地平滑增长，PAUSED 不增长", () => {
  let nowMs = 1_000_000;
  let latest;
  const ticker = createStreamTicker({
    accruedWei: "7000000000000000",
    rateWeiPerSecond: "1000000000000000",
    budgetWei: "20000000000000000",
    status: "ACTIVE",
  }, (display) => { latest = display; }, { intervalMs: 100000, syncedAtMs: nowMs, now: () => nowMs });

  nowMs += 3_000;
  ticker.snapshot();
  assert.equal(latest.accruedWei, "10000000000000000");
  assert.equal(latest.remainingBudgetWei, "10000000000000000");
  assert.equal(latest.estimatedEndSeconds, 10);

  ticker.calibrate({
    accruedWei: latest.accruedWei,
    rateWeiPerSecond: "1000000000000000",
    budgetWei: "20000000000000000",
    status: "PAUSED",
  }, nowMs);
  nowMs += 5_000;
  ticker.snapshot();
  assert.equal(latest.accruedWei, "10000000000000000");
  assert.equal(latest.status, "PAUSED");
  ticker.stop();
});

test("创建 Stream 走 /prepare、RPC Gas 估算和完整交易状态机", async () => {
  const requests = [];
  let receiptReads = 0;
  const provider = {
    async request({ method, params }) {
      requests.push({ method, params });
      if (method === "eth_requestAccounts") return [account];
      if (method === "eth_chainId") return "0x8f";
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_sendTransaction") return txHash;
      if (method === "eth_getTransactionReceipt") {
        receiptReads += 1;
        return receiptReads < 2 ? null : { status: "0x1", transactionHash: txHash, blockNumber: "0x10" };
      }
      throw new Error(`Unexpected provider method: ${method}`);
    },
  };

  let preparedBody;
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/config")) {
      return apiResponse({ data: {
        environment: "test",
        chain: {
          name: "Monad",
          chainId: 143,
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          rpcUrl: "https://rpc.example",
          explorerBaseUrl: "https://explorer.example",
        },
        contracts: { streamSupport: contract },
        features: { streamSupport: true },
      } });
    }
    if (url.endsWith("/notes/note_01/streams/prepare")) {
      preparedBody = JSON.parse(options.body);
      return apiResponse({ data: { tx: {
        chainId: 143,
        to: contract,
        data: "0x1234",
        value: "200000000000000000",
        functionName: "createStream",
        description: "Start streaming support",
      } } });
    }
    throw new Error(`Unexpected API URL: ${url}`);
  };

  const client = new ProofNoteWeb3Client({
    apiBaseUrl: "https://api.example/api/v1",
    provider,
    fetchImpl,
    receiptPollMs: 1,
    receiptTimeoutMs: 100,
  });
  await client.init();
  const states = [];
  const result = await client.createStream({
    noteId: "note_01",
    rateMonPerSecond: "0.001",
    budgetMon: "0.2",
  }, (event) => states.push(event.state));

  assert.deepEqual(preparedBody, {
    rateWeiPerSecond: "1000000000000000",
    budgetWei: "200000000000000000",
  });
  assert.deepEqual(states, [
    WalletTxUiState.PREPARING,
    WalletTxUiState.WAITING_WALLET,
    WalletTxUiState.SUBMITTED,
    WalletTxUiState.CONFIRMED,
  ]);
  assert.equal(result.txHash, txHash);
  assert.equal(result.explorerUrl, `${"https://explorer.example"}/tx/${txHash}`);
  const sent = requests.find((request) => request.method === "eth_sendTransaction");
  assert.equal(sent.params[0].value, "0x2c68af0bb140000");
  assert.equal(sent.params[0].gas, "0x6270");
});

test("用户拒签被转换为可理解错误", () => {
  const error = normalizeWeb3Error({ code: 4001, message: "User rejected" });
  assert.equal(error.code, "USER_REJECTED");
  assert.equal(error.recoverable, true);
  assert.match(error.message, /取消了钱包签名/);
});

test("钱包缺少 Monad 网络时先添加再切换", async () => {
  let chainId = "0x1";
  let firstSwitch = true;
  const methods = [];
  const provider = {
    async request({ method, params }) {
      methods.push(method);
      if (method === "eth_requestAccounts") return [account];
      if (method === "eth_chainId") return chainId;
      if (method === "wallet_switchEthereumChain") {
        if (firstSwitch) {
          firstSwitch = false;
          const error = new Error("Unknown chain");
          error.code = 4902;
          throw error;
        }
        chainId = params[0].chainId;
        return null;
      }
      if (method === "wallet_addEthereumChain") return null;
      throw new Error(`Unexpected provider method: ${method}`);
    },
  };
  const client = new ProofNoteWeb3Client({
    provider,
    fetchImpl: async () => apiResponse({ data: {
      environment: "test",
      chain: {
        name: "Monad",
        chainId: 143,
        nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
        rpcUrl: "https://rpc.example",
        explorerBaseUrl: "https://explorer.example",
      },
      contracts: { streamSupport: contract },
      features: { streamSupport: true },
    } }),
  });
  await client.init();
  const session = await client.connectWallet();
  assert.equal(session.chainId, 143);
  assert.deepEqual(methods.filter((method) => method.startsWith("wallet_")), [
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
  ]);
});

test("交易已确认后，Indexer 延迟不会把 UI 误报为失败", async () => {
  let syncFailure = null;
  const actions = createFrontendBActions({
    client: {
      async pauseStream() { return { txHash, confirmed: true }; },
      async getStream() { throw new Error("Indexer is still syncing"); },
    },
    onSyncError(detail) { syncFailure = detail; },
  });

  const result = await actions.pauseStream("42");
  assert.equal(result.confirmed, true);
  assert.equal(syncFailure.streamId, "42");
  assert.match(syncFailure.error.message, /Indexer/);
});
