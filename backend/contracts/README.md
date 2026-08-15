# ProofNote Contracts

Monad 上的 ProofNote 链上合约：Note 所有权锚定、Direct Tip、按秒流式支持、Impact 证据锚定、参与者证明、Campaign 独立国库。

上游接口冻结：`../ProofNote_MVP_API_SPEC_V1.0.md` §26–§33 · 后端消费方：`../packages/contract-abis/`

## 合约清单

| 合约 | 职责 | 关键安全点 |
|---|---|---|
| `NoteRegistry` | Note 所有权锚定（creator/contentHash/manifestURI） | noteKey 唯一；creator=msg.sender |
| `SupportRouter` | Direct Tip + credit/withdraw（pull payment） | SPEC §57：gross = creator + fee；feeBps 可调 |
| `StreamSupport` | 按秒计提的流式支持状态机 | budget 封顶；pause 不计提；**budget = creatorCredit + fee + refund**；settleExpired 任何人可触发 |
| `ImpactRegistry` | claimHash 不可变锚定 + evidence manifest 版本追加 | version 单调递增；仅作者可更新 |
| `AttestationRegistry` | 参与者/目击者证明 | (impact, attester, type) 唯一 |
| `CampaignTreasuryFactory` | EIP-1167 克隆 + CREATE2（salt=campaignKey） | campaignKey 唯一；确定性地址 |
| `CampaignTreasury` | per-campaign 独立国库 | 仅 organizer spend；CEI+防重入；**raised = spent + remaining** |

Solidity 0.8.28 / `evm_version = prague` / 优化器开启 / 零外部依赖（自含 ReentrancyGuard 与最小代理部署码）。

## 双轨验证（本仓库已全绿）

| 命令 | 说明 | 状态 |
|---|---|---|
| `pnpm verify:all` | 编译 + ABI 比对 + EVM 行为测试 一次跑全 | ✅ 41 组断言 |
| `pnpm compile` | solc-js 0.8.28（prague）编译 → `artifacts/` | ✅ 8 合约 |
| `pnpm abi-check` | 编译产物 vs 后端冻结 ABI（38 项接口逐项签名比对） | ✅ 全匹配 |
| `pnpm test:evm` | @ethereumjs/evm（prague hardfork）真实执行字节码：三个资金不变量、Stream 全状态机、权限、克隆隔离、40 组随机节奏 fuzz | ✅ |

## Foundry（标准工具链，网络可达时）

```bash
# 安装 forge（官方脚本或 Monad 版 foundry —— 见资产清单 §8）
curl -L https://foundry.paradigm.xyz | bash && foundryup
# Monad 行为完全对齐版（128KB 合约上限/gas 重定价）：
# curl -L https://foundry.category.xyz | bash && foundryup --network monad

forge install foundry-rs/forge-std   # 测试依赖（本仓未 vendor）
forge build
forge test -vvv                       # 单测 + 不变量 fuzz（test/*.t.sol）
```

测试覆盖（`test/`）：三个 SPEC §57 守恒式、Stream 生命周期与边界（pause 冻结/resume 续提/封顶/settleExpired 权限）、证据版本单调、attest 去重、国库权限与超支、克隆存储隔离、随机参数 fuzz。

## 部署（Monad 测试网 10143）

```bash
# 1) 准备：已领水的部署钱包（资产清单 §2）
cast wallet import deployer --private-key <DEPLOYER_PRIVATE_KEY>

# 2) 部署（一律 --legacy：EIP-1559 支持未明确，legacy 是安全默认）
forge script script/Deploy.s.sol \
  --rpc-url https://testnet-rpc.monad.xyz \
  --broadcast --legacy \
  --account deployer

# 可选环境变量：PROTOCOL_FEE_BPS（默认200）/ PROTOCOL_FEE_RECIPIENT（默认部署者）

# 3) 源码验证（Monadscan）
forge verify-contract <地址> src/NoteRegistry.sol:NoteRegistry \
  --rpc-url https://testnet-rpc.monad.xyz \
  --verifier-url https://testnet.monadscan.com/api \
  --etherscan-api-key <MONADSCAN_API_KEY> --watch
# （其余合约同法，注意带构造参数 --constructor-args）

# 4) 地址回填 backend/.env 的 CONTRACT_* 六项 → 重启 API/Indexer，自动退出 MOCK_CHAIN 模式
```

部署产物（地址/交易 hash）建议追加记录到 `../ProofNote_ASSETS_CHECKLIST_V1.0.md` §5 登记表。

## 后端联调（部署后）

```bash
cd ../ && pnpm smoke          # 仍应全绿（mock 路径）
# 回填地址后：pnpm dev:api + pnpm dev:indexer，Indexer 从当前块订阅 13 个事件
```

## 目录

```
src/          8 个合约（零外部依赖）
test/         Foundry 测试（需 forge-std）
script/       Deploy.s.sol
scripts/      npm 侧验证工具链（compile / abi-check / evm-test）
artifacts/    solc 编译产物（gitignore，pnpm compile 再生成）
```
