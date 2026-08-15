import { createFrontendBActions } from './src/frontend-a-adapter.mjs';

const fallbackAdapter = window.ProofNoteAdapter;
let activeTxContext = null;
let initialized = null;
let latestConfig = null;
let latestWallet = { connected: false, address: null, chainId: null };
let activeStreamId = null;
let activeBudgetMON = '0.2000';

const mapWallet = (wallet = {}) => ({
  connected: Boolean(wallet.connected ?? wallet.account),
  address: wallet.address ?? wallet.account ?? null,
  chainId: wallet.chainId ?? null
});

const forwardProgress = (event) => {
  if (!activeTxContext?.onPhase) return;
  if (event.state === 'FAILED') return;
  activeTxContext.onPhase(event.state, {
    txHash: event.txHash,
    explorerUrl: event.explorerUrl,
    blockNumber: event.receipt?.blockNumber
  });
};

const actions = createFrontendBActions({
  apiBaseUrl: '/api/v1',
  getAccessToken: () => sessionStorage.getItem('proofnote_access_token'),
  onTransactionProgress: forwardProgress,
  onStreamDisplay(display) {
    window.ProofNoteUI?.setStreamSnapshot({
      streamId: activeStreamId,
      status: display.status,
      accruedMON: display.accruedFormatted,
      budgetMON: activeBudgetMON
    });
  },
  onSyncError({ streamId, error }) {
    window.ProofNoteUI?.showToast(
      '链上已确认，数据仍在同步',
      `Stream #${streamId} 将在索引完成后自动校准。${error?.message ? ` ${error.message}` : ''}`,
      'warning'
    );
  }
});

async function ensureInitialized() {
  if (!initialized) {
    initialized = actions.initialize().then(({ config, wallet }) => {
      latestConfig = config;
      latestWallet = mapWallet(wallet);
      window.ProofNoteUI?.setWalletState(latestWallet);
      actions.subscribeWallet((event) => {
        if (event.type === 'accountsChanged') {
          latestWallet = { ...latestWallet, connected: Boolean(event.account), address: event.account };
        } else if (event.type === 'chainChanged') {
          latestWallet = { ...latestWallet, chainId: event.chainId };
        }
        window.ProofNoteUI?.setWalletState(latestWallet);
      });
      return { config, wallet: latestWallet };
    }).catch((error) => {
      initialized = null;
      throw error;
    });
  }
  return initialized;
}

function streamIdFromReceipt(result) {
  const contract = latestConfig?.contracts?.streamSupport?.toLowerCase();
  const logs = Array.isArray(result?.receipt?.logs) ? result.receipt.logs : [];
  const created = logs.find((log) => {
    const sameContract = !contract || String(log.address ?? '').toLowerCase() === contract;
    return sameContract && Array.isArray(log.topics) && log.topics.length === 4;
  });
  const topic = created?.topics?.[1];
  if (!topic) return null;
  try { return BigInt(topic).toString(); } catch { return null; }
}

async function withTxContext(context, operation) {
  activeTxContext = context;
  try {
    await ensureInitialized();
    return await operation();
  } finally {
    activeTxContext = null;
  }
}

const realAdapter = {
  mode: 'real',

  async getConfig() {
    const { config } = await ensureInitialized();
    return config;
  },

  async getWallet() {
    await ensureInitialized();
    return latestWallet;
  },

  async connectWallet() {
    await ensureInitialized();
    latestWallet = mapWallet(await actions.connectWallet());
    window.ProofNoteUI?.setWalletState(latestWallet);
    return latestWallet;
  },

  async disconnectWallet() {
    actions.client.forgetWallet();
    latestWallet = { ...latestWallet, connected: false, address: null };
    window.ProofNoteUI?.setWalletState(latestWallet);
    return latestWallet;
  },

  async createStream(params, context) {
    activeBudgetMON = params.budgetMON;
    const result = await withTxContext(context, () => actions.createStream(
      params.noteId ?? 'note_01',
      params.rateMONPerSecond,
      params.budgetMON
    ));
    activeStreamId = streamIdFromReceipt(result) ?? result.streamId ?? activeStreamId;
    if (activeStreamId) {
      actions.resyncStream(activeStreamId).catch(() => {});
    }
    return { ...result, streamId: activeStreamId, status: 'ACTIVE' };
  },

  pauseStream(params, context) {
    return withTxContext(context, () => actions.pauseStream(params.streamId));
  },

  resumeStream(params, context) {
    return withTxContext(context, () => actions.resumeStream(params.streamId));
  },

  stopAndSettle(params, context) {
    return withTxContext(context, () => actions.stopAndSettle(params.streamId));
  },

  claimCreatorCredit(_params, context) {
    return withTxContext(context, () => actions.client.withdraw(forwardProgress));
  },

  // These actions are outside the two-hour real-transaction slice. Keep the
  // existing deterministic behavior until matching prepare APIs are available.
  publishNote: (...args) => fallbackAdapter.publishNote(...args),
  sendTip: (...args) => fallbackAdapter.sendTip(...args),
  attestImpact: (...args) => fallbackAdapter.attestImpact(...args),
  attestLedger: (...args) => fallbackAdapter.attestLedger(...args)
};

async function activate() {
  try {
    await ensureInitialized();
    window.ProofNoteUI.useAdapter(realAdapter);
    window.ProofNoteWeb3Status = { ready: true, mode: 'real' };
    return realAdapter;
  } catch (error) {
    // Local static preview has no /api/v1 backend. Keeping Mock is intentional.
    window.ProofNoteWeb3Status = { ready: false, mode: 'mock', error };
    return fallbackAdapter;
  }
}

window.ProofNoteRealBridge = Object.freeze({ activate, adapter: realAdapter, actions });
const requestedMode = new URLSearchParams(window.location.search).get('web3');
if (requestedMode === 'real') {
  activate();
} else {
  window.ProofNoteWeb3Status = { ready: true, mode: 'mock', realAdapterAvailable: true };
}
