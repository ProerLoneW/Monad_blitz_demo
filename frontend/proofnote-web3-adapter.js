/**
 * ProofNote frontend/Web3 boundary.
 *
 * The prototype ships with this deterministic mock so the UI and 90-second demo
 * work without a contract. The wallet/contract owner can replace the adapter at
 * runtime without editing page components:
 *
 *   window.ProofNoteAdapter = createRealProofNoteAdapter({ ... });
 *
 * Every write method accepts `(params, context)`. `context.onPhase` should be
 * called with PREPARING, WAITING_WALLET, SUBMITTED and CONFIRMED. Throw an Error
 * with `code = "USER_REJECTED"` when the wallet request is cancelled.
 */
(function attachProofNoteAdapter(global) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const mockConfig = Object.freeze({
    chainId: 10143,
    chainName: 'Monad Testnet',
    explorerUrl: 'https://testnet.monadexplorer.com',
    protocolFeeBps: 50,
    source: 'mock-config'
  });

  const wallet = {
    connected: true,
    address: '0x8870000000000000000000000000000000003F2a'
  };

  let txNonce = 0x74a9;
  const transactionHash = () => {
    txNonce += 1;
    return `0x${txNonce.toString(16).padStart(64, '0')}`;
  };

  async function mockWrite(_params, context = {}) {
    const onPhase = typeof context.onPhase === 'function' ? context.onPhase : () => {};
    onPhase('PREPARING');
    await sleep(260);
    onPhase('WAITING_WALLET');
    await sleep(420);
    const txHash = transactionHash();
    onPhase('SUBMITTED', { txHash });
    await sleep(520);
    const result = {
      txHash,
      explorerUrl: `${mockConfig.explorerUrl}/tx/${txHash}`,
      blockNumber: 9842116 + txNonce,
      confirmed: true
    };
    onPhase('CONFIRMED', result);
    return result;
  }

  const mockAdapter = {
    mode: 'mock',

    async getConfig() {
      return mockConfig;
    },

    async getWallet() {
      return { ...wallet, chainId: mockConfig.chainId };
    },

    async connectWallet() {
      await sleep(180);
      wallet.connected = true;
      return { ...wallet, chainId: mockConfig.chainId };
    },

    async disconnectWallet() {
      wallet.connected = false;
      return { ...wallet, chainId: mockConfig.chainId };
    },

    async publishNote(params, context) {
      return { ...(await mockWrite(params, context)), contentHash: '0x79f3c21d', manifestUri: 'ipfs://bafy8ab1' };
    },

    async sendTip(params, context) {
      return { ...(await mockWrite(params, context)), creatorCreditMON: '0.049000', protocolFeeMON: '0.001000' };
    },

    async createStream(params, context) {
      return { ...(await mockWrite(params, context)), streamId: '42', status: 'ACTIVE' };
    },

    async pauseStream(params, context) {
      return { ...(await mockWrite(params, context)), streamId: params.streamId, status: 'PAUSED' };
    },

    async resumeStream(params, context) {
      return { ...(await mockWrite(params, context)), streamId: params.streamId, status: 'ACTIVE' };
    },

    async stopAndSettle(params, context) {
      return { ...(await mockWrite(params, context)), streamId: params.streamId, status: 'SETTLED' };
    },

    async claimCreatorCredit(params, context) {
      return { ...(await mockWrite(params, context)), claimedMON: params.amountMON };
    },

    async attestImpact(params, context) {
      return { ...(await mockWrite(params, context)), claimId: params.claimId };
    },

    async attestLedger(params, context) {
      return { ...(await mockWrite(params, context)), claimId: params.claimId };
    }
  };

  global.ProofNoteAdapter = global.ProofNoteAdapter || mockAdapter;
  global.ProofNoteAdapterContract = Object.freeze({
    phases: ['PREPARING', 'WAITING_WALLET', 'SUBMITTED', 'CONFIRMED'],
    requiredMethods: [
      'getConfig',
      'getWallet',
      'connectWallet',
      'disconnectWallet',
      'createStream',
      'pauseStream',
      'resumeStream',
      'stopAndSettle',
      'claimCreatorCredit'
    ]
  });
})(window);
