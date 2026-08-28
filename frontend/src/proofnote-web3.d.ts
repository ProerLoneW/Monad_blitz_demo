export type Address = `0x${string}`;
export type TxHash = `0x${string}`;
export type WalletTxUiState = "IDLE" | "PREPARING" | "WAITING_WALLET" | "SUBMITTED" | "CONFIRMED" | "FAILED";
export type StreamStatus = "ACTIVE" | "PAUSED" | "DEPLETED" | "SETTLED";

export type ChainConfig = {
  name: string;
  chainId: number;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrl: string;
  explorerBaseUrl: string;
};

export type ProofNoteConfig = {
  environment: string;
  chain: ChainConfig;
  contracts: {
    noteRegistry: Address;
    supportRouter: Address;
    streamSupport: Address;
    impactRegistry: Address;
    attestationRegistry: Address;
    campaignTreasuryFactory: Address;
  };
  features: {
    directTip: boolean;
    streamSupport: boolean;
    impact: boolean;
    campaign: boolean;
    attestation: boolean;
  };
};

export type TxRequest = {
  chainId: number;
  to: Address;
  data: `0x${string}`;
  value: string;
  functionName: string;
  description: string;
};

export type WalletTxEvent = {
  state: WalletTxUiState;
  description?: string;
  functionName?: string;
  txHash?: TxHash;
  explorerUrl?: string;
  receipt?: unknown;
  error?: ProofNoteWeb3Error;
};

export type WalletTxResult = {
  txHash: TxHash;
  explorerUrl: string;
  receipt: unknown;
  chainId: number;
};

export type Stream = {
  streamId: string;
  noteId: string;
  supporter: Address;
  creator: Address;
  rateWeiPerSecond: string;
  budgetWei: string;
  accruedWei: string;
  remainingBudgetWei: string;
  activeSince?: string;
  status: StreamStatus;
  estimatedEndAt?: string;
};

export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<any>;
  on?(event: string, listener: (...args: any[]) => void): void;
  removeListener?(event: string, listener: (...args: any[]) => void): void;
};

export class ProofNoteWeb3Error extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly details?: unknown;
}

export const WalletTxUiState: Readonly<Record<WalletTxUiState, WalletTxUiState>>;
export function parseDecimalToUnits(value: string, decimals?: number): bigint;
export function formatUnits(value: bigint | string, decimals?: number, maxFractionDigits?: number): string;
export function parseMon(value: string): bigint;
export function formatMon(value: bigint | string, maxFractionDigits?: number): string;
export function toRpcHex(value: bigint | string): `0x${string}`;
export function normalizeWeb3Error(error: unknown): ProofNoteWeb3Error;

export class ProofNoteWeb3Client {
  constructor(options?: {
    apiBaseUrl?: string;
    provider?: Eip1193Provider;
    fetchImpl?: typeof fetch;
    getAccessToken?: () => string | null | Promise<string | null>;
    receiptPollMs?: number;
    receiptTimeoutMs?: number;
    gasBufferBps?: number;
  });

  init(): Promise<ProofNoteConfig>;
  getConfig(): ProofNoteConfig;
  connectWallet(options?: { switchChain?: boolean }): Promise<{ account: Address; chainId: number }>;
  forgetWallet(): void;
  getWalletSession(): Promise<{ account: Address | null; chainId: number; connected: boolean }>;
  subscribeWallet(callback: (event: { type: "accountsChanged"; account: Address | null } | { type: "chainChanged"; chainId: number }) => void): () => void;
  ensureMonadNetwork(): Promise<void>;
  getNativeBalance(address?: Address | null): Promise<{ amountWei: string; formatted: string; symbol: string }>;

  createStream(input: { noteId: string; rateMonPerSecond: string; budgetMon: string }, onState?: (event: WalletTxEvent) => void): Promise<WalletTxResult & { rateWeiPerSecond: string; budgetWei: string }>;
  pauseStream(streamId: string, onState?: (event: WalletTxEvent) => void): Promise<WalletTxResult>;
  resumeStream(streamId: string, onState?: (event: WalletTxEvent) => void): Promise<WalletTxResult>;
  stopAndSettle(streamId: string, onState?: (event: WalletTxEvent) => void): Promise<WalletTxResult>;
  withdraw(onState?: (event: WalletTxEvent) => void): Promise<WalletTxResult>;

  getStream(streamId: string): Promise<Stream>;
  getIncomingStreams(address: Address): Promise<unknown>;
  getClaimable(address: Address): Promise<unknown>;
  getExplorerTxUrl(txHash: TxHash): string;
  executeTxRequest(tx: TxRequest, onState?: (event: WalletTxEvent) => void): Promise<WalletTxResult>;
}

export type StreamDisplay = {
  status: StreamStatus;
  accruedWei: string;
  remainingBudgetWei: string;
  accruedFormatted: string;
  remainingFormatted: string;
  estimatedEndSeconds: number | null;
};

export function createStreamTicker(
  snapshot: Pick<Stream, "accruedWei" | "rateWeiPerSecond" | "budgetWei" | "status">,
  onTick: (display: StreamDisplay) => void,
  options?: { intervalMs?: number; syncedAtMs?: number; now?: () => number },
): {
  stop(): void;
  calibrate(nextSnapshot: Pick<Stream, "accruedWei" | "rateWeiPerSecond" | "budgetWei" | "status">, nextSyncedAtMs?: number): StreamDisplay;
  snapshot(): StreamDisplay;
};
