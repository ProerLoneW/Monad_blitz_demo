// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {NoteRegistry} from "../src/NoteRegistry.sol";
import {SupportRouter} from "../src/SupportRouter.sol";
import {StreamSupport} from "../src/StreamSupport.sol";
import {ImpactRegistry} from "../src/ImpactRegistry.sol";
import {AttestationRegistry} from "../src/AttestationRegistry.sol";
import {CampaignTreasuryFactory} from "../src/CampaignTreasuryFactory.sol";

/**
 * Monad 测试网部署（SPEC §55 顺序：先核心资金链路）。
 *
 * forge script script/Deploy.s.sol \
 *   --rpc-url $RPC_URL_TESTNET \
 *   --broadcast --legacy \
 *   --account <cast-wallet-name> \
 *   --verify --verifier-url https://testnet.monadscan.com/api --etherscan-api-key $MONADSCAN_API_KEY
 *
 * 环境变量（可选，缺省用部署者地址 / 200bps）：
 *   PROTOCOL_FEE_BPS / PROTOCOL_FEE_RECIPIENT
 */
contract Deploy is Script {
    // 与后端 backend/.env 的 PROTOCOL_FEE_BPS_FALLBACK 保持一致
    uint16 constant DEFAULT_FEE_BPS = 200;

    function run() external {
        uint256 deployer = vm.envUint("PRIVATE_KEY");
        uint16 feeBps = uint16(vm.envOr("PROTOCOL_FEE_BPS", uint256(DEFAULT_FEE_BPS)));
        address feeRecipient = vm.envOr("PROTOCOL_FEE_RECIPIENT", vm.addr(deployer));

        vm.startBroadcast(deployer);

        NoteRegistry noteRegistry = new NoteRegistry();
        SupportRouter supportRouter = new SupportRouter(feeBps, feeRecipient);
        StreamSupport streamSupport = new StreamSupport(feeBps, feeRecipient);
        ImpactRegistry impactRegistry = new ImpactRegistry();
        AttestationRegistry attestationRegistry = new AttestationRegistry();
        CampaignTreasuryFactory campaignFactory = new CampaignTreasuryFactory();

        vm.stopBroadcast();

        // 部署产物 → 逐项回填 backend/.env（CONTRACT_*），保存交易 hash 到 README
        console2.log("CONTRACT_NOTE_REGISTRY=", address(noteRegistry));
        console2.log("CONTRACT_SUPPORT_ROUTER=", address(supportRouter));
        console2.log("CONTRACT_STREAM_SUPPORT=", address(streamSupport));
        console2.log("CONTRACT_IMPACT_REGISTRY=", address(impactRegistry));
        console2.log("CONTRACT_ATTESTATION_REGISTRY=", address(attestationRegistry));
        console2.log("CONTRACT_CAMPAIGN_TREASURY_FACTORY=", address(campaignFactory));
        console2.log("feeRecipient=", feeRecipient);
        console2.log("feeBps=", feeBps);
    }
}
