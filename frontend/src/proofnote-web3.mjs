const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const HEX_RE = /^0x[0-9a-fA-F]*$/;

export const WalletTxUiState = Object.freeze({
  IDLE: "IDLE",
  PREPARING: "PREPARING",
  WAITING_WALLET: "WAITING_WALLET",
  SUBMITTED: "SUBMITTED",
  CONFIRMED: "CONFIRMED",
  FAILED: "FAILED",
});

export class ProofNoteWeb3Error extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "ProofNoteWeb3Error";
    this.code = code;
    this.recoverable = options.recoverable ?? true;
    this.details = options.details;
  }
}

export function parseDecimalToUnits(value, decimals = 18) {
  if (typeof value !== "string") {
    throw new ProofNoteWeb3Error("INVALID_AMOUNT", "金额必须以字符串传入，不能使用 JS number。", { recoverable: true });
  }

  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new ProofNoteWeb3Error("INVALID_AMOUNT", `金额格式无效：${value}`, { recoverable: true });
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new ProofNoteWeb3Error("INVALID_DECIMALS", "decimals 必须是 0–255 的整数。", { recoverable: false });
  }

  const [whole, rawFraction = ""] = normalized.split(".");
  if (rawFraction.length > decimals && /[1-9]/.test(rawFraction.slice(decimals))) {
    throw new ProofNoteWeb3Error("AMOUNT_TOO_PRECISE", `金额最多支持 ${decimals} 位小数。`, { recoverable: true });
  }

  const fraction = rawFraction.slice(0, decimals).padEnd(decimals, "0") || "0";
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction);
}

export function formatUnits(value, decimals = 18, maxFractionDigits = 6) {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = (absolute % base).toString().padStart(decimals, "0");
  const visible = fraction.slice(0, Math.max(0, maxFractionDigits)).replace(/0+$/, "");
  return visible ? `${sign}${whole}.${visible}` : `${sign}${whole}`;
}

export function parseMon(value) {
  return parseDecimalToUnits(value, 18);
}

export function formatMon(value, maxFractionDigits = 6) {
  return formatUnits(value, 18, maxFractionDigits);
}

export function toRpcHex(value) {
  const bigint = typeof value === "bigint" ? value : BigInt(value);
  if (bigint < 0n) throw new ProofNoteWeb3Error("NEGATIVE_RPC_VALUE", "RPC 数值不能为负数。", { recoverable: false });
  return `0x${bigint.toString(16)}`;
}

function isReceiptSuccessful(receipt) {
  const status = receipt?.status;
  return status === "0x1" || status === 1 || status === 1n || status === true;
}

function assertAddress(value, label) {
  if (!ADDRESS_RE.test(value ?? "")) {
    throw new ProofNoteWeb3Error("INVALID_ADDRESS", `${label} 不是有效的 EVM 地址。`, { recoverable: false, details: value });
  }
}

function assertTxRequest(tx) {
  if (!tx || typeof tx !== "object") {
    throw new ProofNoteWeb3Error("INVALID_TX_REQUEST", "后端没有返回有效的交易请求。", { recoverable: false });
  }
  if (!Number.isInteger(tx.chainId) || tx.chainId <= 0) {
    throw new ProofNoteWeb3Error("INVALID_TX_CHAIN", "交易请求缺少有效 Chain ID。", { recoverable: false });
  }
  assertAddress(tx.to, "交易目标地址");
  if (!HEX_RE.test(tx.data ?? "")) {
    throw new ProofNoteWeb3Error("INVALID_TX_DATA", "交易 calldata 不是有效十六进制数据。", { recoverable: false });
  }
  if (!/^\d+$/.test(tx.value ?? "")) {
    throw new ProofNoteWeb3Error("INVALID_TX_VALUE", "交易 value 必须是 wei 字符串。", { recoverable: false });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeWeb3Error(error) {
  if (error instanceof ProofNoteWeb3Error) return error;

  const rawCode = error?.code;
  const message = String(error?.shortMessage ?? error?.message ?? error ?? "未知错误");
  const lowered = message.toLowerCase();

  if (rawCode === 4001 || rawCode === "ACTION_REJECTED") {
    return new ProofNoteWeb3Error("USER_REJECTED", "你取消了钱包签名，资金和链上状态均未改变。", { cause: error, recoverable: true });
  }
  if (rawCode === -32002 || lowered.includes("already pending")) {
    return new ProofNoteWeb3Error("WALLET_REQUEST_PENDING", "钱包中已有待处理请求，请先完成或关闭它。", { cause: error, recoverable: true });
  }
  if (lowered.includes("insufficient funds") || lowered.includes("exceeds balance")) {
    return new ProofNoteWeb3Error("INSUFFICIENT_FUNDS", "钱包余额不足，无法支付预算和 Gas。", { cause: error, recoverable: true });
  }
  if (lowered.includes("revert") || lowered.includes("execution reverted")) {
    return new ProofNoteWeb3Error("CONTRACT_REVERTED", "合约拒绝了这次操作，请刷新 Stream 状态后重试。", { cause: error, recoverable: true });
  }
  if (lowered.includes("timeout") || lowered.includes("timed out")) {
    return new ProofNoteWeb3Error("TRANSACTION_TIMEOUT", "交易确认时间过长，可通过 Tx Hash 在 Explorer 中继续核验。", { cause: error, recoverable: true });
  }
  if (lowered.includes("network") || lowered.includes("rpc") || lowered.includes("fetch")) {
    return new ProofNoteWeb3Error("NETWORK_UNAVAILABLE", "当前无法连接 Monad 网络，请检查网络后重试。", { cause: error, recoverable: true });
  }

  return new ProofNoteWeb3Error("UNKNOWN_WEB3_ERROR", message, { cause: error, recoverable: true });
}

export class ProofNoteWeb3Client {
  constructor(options = {}) {
    this.apiBaseUrl = String(options.apiBaseUrl ?? "/api/v1").replace(/\/$/, "");
    this.provider = options.provider ?? globalThis.window?.ethereum;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    this.getAccessToken = options.getAccessToken ?? (() => null);
    this.receiptPollMs = options.receiptPollMs ?? 1200;
    this.receiptTimeoutMs = options.receiptTimeoutMs ?? 120000;
    this.gasBufferBps = options.gasBufferBps ?? 12000;
    this.config = null;
    this.account = null;
  }

  async init() {
    this.config = await this.#api("/config");
    this.#validateConfig(this.config);
    return this.config;
  }

  getConfig() {
    if (!this.config) {
      throw new ProofNoteWeb3Error("CONFIG_NOT_LOADED", "请先调用 init() 读取 ProofNote 配置。", { recoverable: false });
    }
    return this.config;
  }

  async connectWallet(options = {}) {
    this.#requireProvider();
    const accounts = await this.provider.request({ method: "eth_requestAccounts" });
    const account = accounts?.[0];
    assertAddress(account, "钱包地址");
    this.account = account;
    if (options.switchChain !== false) await this.ensureMonadNetwork();
    const chainId = Number(BigInt(await this.provider.request({ method: "eth_chainId" })));
    return { account: this.account, chainId };
  }

  forgetWallet() {
    this.account = null;
  }

  async getWalletSession() {
    this.#requireProvider();
    const accounts = await this.provider.request({ method: "eth_accounts" });
    const account = accounts?.[0] ?? null;
    const chainId = Number(BigInt(await this.provider.request({ method: "eth_chainId" })));
    if (account) assertAddress(account, "钱包地址");
    this.account = account;
    return { account, chainId, connected: Boolean(account) };
  }

  subscribeWallet(callback) {
    this.#requireProvider();
    if (typeof this.provider.on !== "function") return () => {};
    const accountsChanged = (accounts) => {
      this.account = accounts?.[0] ?? null;
      callback({ type: "accountsChanged", account: this.account });
    };
    const chainChanged = (chainIdHex) => callback({ type: "chainChanged", chainId: Number(BigInt(chainIdHex)) });
    this.provider.on("accountsChanged", accountsChanged);
    this.provider.on("chainChanged", chainChanged);
    return () => {
      this.provider.removeListener?.("accountsChanged", accountsChanged);
      this.provider.removeListener?.("chainChanged", chainChanged);
    };
  }

  async ensureMonadNetwork() {
    this.#requireProvider();
    const { chain } = this.getConfig();
    const expectedHex = toRpcHex(chain.chainId);
    const currentHex = await this.provider.request({ method: "eth_chainId" });
    if (Number(BigInt(currentHex)) === chain.chainId) return;

    try {
      await this.provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: expectedHex }],
      });
    } catch (error) {
      if (error?.code !== 4902) throw normalizeWeb3Error(error);
      await this.provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: expectedHex,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [chain.rpcUrl],
          blockExplorerUrls: [chain.explorerBaseUrl],
        }],
      });
      await this.provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: expectedHex }],
      });
    }
  }

  async getNativeBalance(address = this.account) {
    this.#requireProvider();
    assertAddress(address, "查询地址");
    const value = await this.provider.request({ method: "eth_getBalance", params: [address, "latest"] });
    const wei = BigInt(value);
    return { amountWei: wei.toString(), formatted: formatMon(wei), symbol: this.getConfig().chain.nativeCurrency.symbol };
  }

  async createStream(input, onState) {
    if (!input?.noteId) throw new ProofNoteWeb3Error("NOTE_ID_REQUIRED", "创建 Stream 需要 noteId。", { recoverable: true });
    const rateWei = parseMon(input.rateMonPerSecond);
    const budgetWei = parseMon(input.budgetMon);
    if (rateWei <= 0n || budgetWei <= 0n) {
      throw new ProofNoteWeb3Error("INVALID_STREAM_AMOUNT", "Rate 和 Max Budget 必须大于 0。", { recoverable: true });
    }
    if (budgetWei < rateWei) {
      throw new ProofNoteWeb3Error("BUDGET_TOO_SMALL", "Max Budget 至少应覆盖 1 秒的 Stream。", { recoverable: true });
    }

    const result = await this.#prepareAndExecute(
      `/notes/${encodeURIComponent(input.noteId)}/streams/prepare`,
      { rateWeiPerSecond: rateWei.toString(), budgetWei: budgetWei.toString() },
      onState,
    );
    return { ...result, rateWeiPerSecond: rateWei.toString(), budgetWei: budgetWei.toString() };
  }

  async pauseStream(streamId, onState) {
    return this.#streamAction(streamId, "pause", onState);
  }

  async resumeStream(streamId, onState) {
    return this.#streamAction(streamId, "resume", onState);
  }

  async stopAndSettle(streamId, onState) {
    return this.#streamAction(streamId, "stop", onState);
  }

  async withdraw(onState) {
    return this.#prepareAndExecute("/streams/withdraw/prepare", undefined, onState);
  }

  async getStream(streamId) {
    this.#assertStreamId(streamId);
    return this.#api(`/streams/${encodeURIComponent(String(streamId))}`);
  }

  async getIncomingStreams(address) {
    assertAddress(address, "Creator 地址");
    return this.#api(`/profiles/${encodeURIComponent(address)}/streams/incoming`);
  }

  async getClaimable(address) {
    assertAddress(address, "Creator 地址");
    return this.#api(`/profiles/${encodeURIComponent(address)}/claimable`);
  }

  getExplorerTxUrl(txHash) {
    if (!HASH_RE.test(txHash ?? "")) {
      throw new ProofNoteWeb3Error("INVALID_TX_HASH", "Tx Hash 格式无效。", { recoverable: false });
    }
    return `${this.getConfig().chain.explorerBaseUrl.replace(/\/$/, "")}/tx/${txHash}`;
  }

  async executeTxRequest(tx, onState) {
    try {
      assertTxRequest(tx);
      this.#emit(onState, WalletTxUiState.PREPARING, { description: tx.description, functionName: tx.functionName });
      this.#requireProvider();
      if (!this.account) await this.connectWallet();
      else await this.ensureMonadNetwork();

      const configuredChainId = this.getConfig().chain.chainId;
      if (tx.chainId !== configuredChainId) {
        throw new ProofNoteWeb3Error("TX_CHAIN_MISMATCH", `交易 Chain ID ${tx.chainId} 与配置 ${configuredChainId} 不一致。`, { recoverable: false });
      }

      const transaction = {
        from: this.account,
        to: tx.to,
        data: tx.data,
        value: toRpcHex(BigInt(tx.value)),
      };

      this.#emit(onState, WalletTxUiState.WAITING_WALLET, { description: tx.description, functionName: tx.functionName });
      const estimatedGasHex = await this.provider.request({ method: "eth_estimateGas", params: [transaction] });
      const estimatedGas = BigInt(estimatedGasHex);
      transaction.gas = toRpcHex((estimatedGas * BigInt(this.gasBufferBps) + 9999n) / 10000n);

      const txHash = await this.provider.request({ method: "eth_sendTransaction", params: [transaction] });
      if (!HASH_RE.test(txHash ?? "")) {
        throw new ProofNoteWeb3Error("INVALID_TX_HASH", "钱包没有返回有效 Tx Hash。", { recoverable: false, details: txHash });
      }

      const explorerUrl = this.getExplorerTxUrl(txHash);
      this.#emit(onState, WalletTxUiState.SUBMITTED, { txHash, explorerUrl });
      const receipt = await this.#waitForReceipt(txHash);
      if (!isReceiptSuccessful(receipt)) {
        throw new ProofNoteWeb3Error("TRANSACTION_REVERTED", "交易已上链但执行失败，请在 Explorer 中查看原因。", {
          recoverable: true,
          details: { txHash, explorerUrl, receipt },
        });
      }

      const result = { txHash, explorerUrl, receipt, chainId: tx.chainId };
      this.#emit(onState, WalletTxUiState.CONFIRMED, result);
      return result;
    } catch (error) {
      const normalized = normalizeWeb3Error(error);
      this.#emit(onState, WalletTxUiState.FAILED, { error: normalized });
      throw normalized;
    }
  }

  async #prepareAndExecute(path, body, onState) {
    let transactionStarted = false;
    try {
      this.#emit(onState, WalletTxUiState.PREPARING, {});
      const data = await this.#api(path, { method: "POST", body });
      transactionStarted = true;
      return await this.executeTxRequest(data.tx, (event) => {
        if (event.state !== WalletTxUiState.PREPARING) this.#emit(onState, event.state, event);
      });
    } catch (error) {
      const normalized = normalizeWeb3Error(error);
      if (!transactionStarted) this.#emit(onState, WalletTxUiState.FAILED, { error: normalized });
      throw normalized;
    }
  }

  async #streamAction(streamId, action, onState) {
    this.#assertStreamId(streamId);
    return this.#prepareAndExecute(`/streams/${encodeURIComponent(String(streamId))}/${action}/prepare`, undefined, onState);
  }

  async #waitForReceipt(txHash) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.receiptTimeoutMs) {
      const receipt = await this.provider.request({ method: "eth_getTransactionReceipt", params: [txHash] });
      if (receipt) return receipt;
      await sleep(this.receiptPollMs);
    }
    throw new ProofNoteWeb3Error("TRANSACTION_TIMEOUT", "交易已提交，但等待确认超时。", {
      recoverable: true,
      details: { txHash, explorerUrl: this.getExplorerTxUrl(txHash) },
    });
  }

  async #api(path, options = {}) {
    if (!this.fetchImpl) {
      throw new ProofNoteWeb3Error("FETCH_UNAVAILABLE", "当前环境不支持 API 请求。", { recoverable: false });
    }
    const token = await this.getAccessToken();
    const headers = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;
    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      throw new ProofNoteWeb3Error("API_UNAVAILABLE", "无法连接 ProofNote API。", { cause: error, recoverable: true });
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ProofNoteWeb3Error(payload?.error?.code ?? `HTTP_${response.status}`, payload?.error?.message ?? "ProofNote API 请求失败。", {
        recoverable: response.status >= 400 && response.status < 500,
        details: { requestId: payload?.error?.requestId, status: response.status },
      });
    }
    if (!payload || !("data" in payload)) {
      throw new ProofNoteWeb3Error("INVALID_API_RESPONSE", "ProofNote API 响应缺少 data。", { recoverable: false });
    }
    return payload.data;
  }

  #validateConfig(config) {
    if (!config?.chain || !Number.isInteger(config.chain.chainId) || config.chain.chainId <= 0) {
      throw new ProofNoteWeb3Error("INVALID_CONFIG", "/config 缺少有效 Chain ID。", { recoverable: false });
    }
    if (!config.chain.rpcUrl || !config.chain.explorerBaseUrl || !config.chain.nativeCurrency) {
      throw new ProofNoteWeb3Error("INVALID_CONFIG", "/config 缺少 RPC、Explorer 或原生代币配置。", { recoverable: false });
    }
    if (!config.features?.streamSupport) {
      throw new ProofNoteWeb3Error("STREAM_FEATURE_DISABLED", "当前环境未启用 Stream Support。", { recoverable: false });
    }
    assertAddress(config.contracts?.streamSupport, "StreamSupport 合约地址");
  }

  #requireProvider() {
    if (!this.provider?.request) {
      throw new ProofNoteWeb3Error("WALLET_NOT_INSTALLED", "未检测到 EVM 钱包，请安装并启用钱包。", { recoverable: true });
    }
  }

  #assertStreamId(streamId) {
    if (!/^\d+$/.test(String(streamId ?? ""))) {
      throw new ProofNoteWeb3Error("INVALID_STREAM_ID", "streamId 必须是链上 uint256 字符串。", { recoverable: true });
    }
  }

  #emit(callback, state, detail) {
    callback?.({ state, ...detail });
  }
}

export function createStreamTicker(snapshot, onTick, options = {}) {
  let current = normalizeStreamSnapshot(snapshot);
  let syncedAtMs = options.syncedAtMs ?? Date.now();
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? 250;

  const calculate = () => {
    const baseAccrued = BigInt(current.accruedWei);
    const rate = BigInt(current.rateWeiPerSecond);
    const budget = BigInt(current.budgetWei);
    const elapsedMs = current.status === "ACTIVE" ? Math.max(0, now() - syncedAtMs) : 0;
    const accrued = minBigInt(budget, baseAccrued + (rate * BigInt(Math.floor(elapsedMs))) / 1000n);
    const remaining = budget - accrued;
    const estimatedEndSeconds = current.status === "ACTIVE" && rate > 0n ? Number(ceilDiv(remaining, rate)) : null;
    const derivedStatus = accrued >= budget && current.status === "ACTIVE" ? "DEPLETED" : current.status;

    const display = {
      status: derivedStatus,
      accruedWei: accrued.toString(),
      remainingBudgetWei: remaining.toString(),
      accruedFormatted: formatMon(accrued, 6),
      remainingFormatted: formatMon(remaining, 6),
      estimatedEndSeconds,
    };
    onTick(display);
    return display;
  };

  const timer = setInterval(calculate, intervalMs);
  calculate();
  return {
    stop() { clearInterval(timer); },
    calibrate(nextSnapshot, nextSyncedAtMs = Date.now()) {
      current = normalizeStreamSnapshot(nextSnapshot);
      syncedAtMs = nextSyncedAtMs;
      return calculate();
    },
    snapshot: calculate,
  };
}

function normalizeStreamSnapshot(stream) {
  for (const key of ["accruedWei", "rateWeiPerSecond", "budgetWei"]) {
    if (!/^\d+$/.test(stream?.[key] ?? "")) {
      throw new ProofNoteWeb3Error("INVALID_STREAM_SNAPSHOT", `Stream ${key} 必须是 wei 字符串。`, { recoverable: false });
    }
  }
  if (!["ACTIVE", "PAUSED", "DEPLETED", "SETTLED"].includes(stream.status)) {
    throw new ProofNoteWeb3Error("INVALID_STREAM_STATUS", `未知 Stream 状态：${stream.status}`, { recoverable: false });
  }
  return { ...stream };
}

function minBigInt(a, b) {
  return a < b ? a : b;
}

function ceilDiv(a, b) {
  if (a === 0n) return 0n;
  return (a + b - 1n) / b;
}
