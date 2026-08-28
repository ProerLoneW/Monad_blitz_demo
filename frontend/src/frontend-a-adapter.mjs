import { createStreamTicker, ProofNoteWeb3Client, WalletTxUiState } from "./proofnote-web3.mjs";

const DEFAULT_COPY = Object.freeze({
  [WalletTxUiState.PREPARING]: "准备交易参数",
  [WalletTxUiState.WAITING_WALLET]: "等待钱包确认",
  [WalletTxUiState.SUBMITTED]: "交易已提交",
  [WalletTxUiState.CONFIRMED]: "已在 Monad 确认",
  [WalletTxUiState.FAILED]: "交易失败",
});

/**
 * 前端 A 只需要消费这里的 actions，不接触 provider、RPC、wei 或交易轮询。
 */
export function createFrontendBActions(options = {}) {
  const client = options.client ?? new ProofNoteWeb3Client({
    apiBaseUrl: options.apiBaseUrl,
    provider: options.provider,
    fetchImpl: options.fetchImpl,
    getAccessToken: options.getAccessToken,
  });
  const onTransactionProgress = options.onTransactionProgress ?? (() => {});
  const onStreamDisplay = options.onStreamDisplay ?? (() => {});
  const onSyncError = options.onSyncError ?? (() => {});
  let ticker = null;

  const txProgress = (event) => {
    onTransactionProgress({
      ...event,
      label: DEFAULT_COPY[event.state] ?? event.state,
      canClose: event.state === WalletTxUiState.CONFIRMED || event.state === WalletTxUiState.FAILED,
    });
  };

  const resync = async (streamId) => {
    const stream = await client.getStream(streamId);
    ticker?.stop();
    ticker = createStreamTicker(stream, onStreamDisplay, { syncedAtMs: Date.now(), intervalMs: 250 });
    return stream;
  };

  const resyncAfterConfirmedWrite = async (streamId) => {
    try {
      return await resync(streamId);
    } catch (error) {
      // The transaction is already confirmed. Indexer/API lag must not turn a
      // successful wallet action into a FAILED transaction state in the UI.
      onSyncError({ streamId, error });
      return null;
    }
  };

  return {
    client,

    async initialize() {
      const config = await client.init();
      const wallet = await client.getWalletSession();
      return { config, wallet };
    },

    connectWallet() {
      return client.connectWallet();
    },

    async createStream(noteId, rateMonPerSecond, budgetMon) {
      const result = await client.createStream({ noteId, rateMonPerSecond, budgetMon }, txProgress);
      return result;
    },

    async pauseStream(streamId) {
      const result = await client.pauseStream(streamId, txProgress);
      await resyncAfterConfirmedWrite(streamId);
      return result;
    },

    async resumeStream(streamId) {
      const result = await client.resumeStream(streamId, txProgress);
      await resyncAfterConfirmedWrite(streamId);
      return result;
    },

    async stopAndSettle(streamId) {
      const result = await client.stopAndSettle(streamId, txProgress);
      await resyncAfterConfirmedWrite(streamId);
      return result;
    },

    resyncStream: resync,

    stopStreamAnimation() {
      ticker?.stop();
      ticker = null;
    },

    getExplorerTxUrl(txHash) {
      return client.getExplorerTxUrl(txHash);
    },

    subscribeWallet(callback) {
      return client.subscribeWallet(callback);
    },
  };
}
