/**
 * Monad 测试网钱包联通性检查：
 *   pnpm check:wallets [0x地址 ...]
 * 不带参数时使用 .env 中 DEMO_* 地址（缺省用内置演示名单）。
 * 输出：chainId / 当前块高 / 每地址余额(MON) 与 nonce。
 */
process.env.LOG_LEVEL ??= 'warn';
import { createPublicClient, http, formatUnits } from 'viem';
import { loadEnvFile } from '@proofnote/chain-config';

loadEnvFile();

const DEFAULT_ROSTER: Array<{ name: string; address: string }> = [
  { name: 'Deployer', address: '0xddB57b8eAa52589842f0Df7973a011FB5fcD26cC' },
  { name: 'Alice', address: '0x5aD130dfcd8Dad26BA822a968df4BAabA48Fea24' },
  { name: 'Bob', address: '0x91394bc16C27df9022A7Bd64A96740ff0e6f5098' },
  { name: 'Charlie', address: '0x66Db771C51Bd9c90B88EdC7a04A9236B189078e0' },
  { name: 'Organizer', address: '0xFD56ee0b1a873f91E2618C6bD9b3683d090E8657' },
  { name: 'Supplier', address: '0x7E5360FaCA234309B7FdefBa12bCC4dCD162C0B2' },
  { name: 'Dave', address: '0x68C96AdFB1eEAFBaCE152836761B15db90ED7493' },
];

function rosterFromArgs(args: string[]): Array<{ name: string; address: string }> {
  return args.map((a, i) => ({ name: `Wallet-${i + 1}`, address: a }));
}

async function main() {
  const args = process.argv.slice(2);
  const roster = args.length > 0 ? rosterFromArgs(args) : DEFAULT_ROSTER;

  const client = createPublicClient({ transport: http(process.env.RPC_URL_HTTP ?? 'https://testnet-rpc.monad.xyz') });

  const chainId = await client.getChainId();
  const blockNumber = await client.getBlockNumber();
  const block = await client.getBlock({ blockNumber });
  console.log(`Monad 测试网连通 ✔  chainId=${chainId} (期望 10143)`);
  console.log(`当前块高 ${blockNumber}，块时间戳 ${new Date(Number(block.timestamp) * 1000).toISOString()}\n`);

  console.log('地址'.padEnd(10), '账户'.padEnd(44), '余额(MON)'.padStart(14), 'nonce'.padStart(8));
  console.log('-'.repeat(80));
  for (const w of roster) {
    try {
      const [balance, nonce] = await Promise.all([
        client.getBalance({ address: w.address as `0x${string}` }),
        client.getTransactionCount({ address: w.address as `0x${string}` }),
      ]);
      console.log(
        w.name.padEnd(10),
        w.address.padEnd(44),
        formatUnits(balance, 18).padStart(14),
        String(nonce).padStart(8),
      );
    } catch (err) {
      console.log(w.name.padEnd(10), w.address.padEnd(44), `查询失败: ${(err as Error).message}`.padStart(24));
    }
  }
  console.log('\n说明：nonce>0 表示该地址已在测试网发过交易；余额为 0 的地址演示前需领水（faucet.monad.xyz）。');
}

main().catch((err) => {
  console.error('check-wallets failed:', err.message);
  process.exit(1);
});
