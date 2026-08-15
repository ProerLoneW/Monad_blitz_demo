// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CampaignTreasury} from "./CampaignTreasury.sol";

/**
 * CampaignTreasuryFactory — per-campaign 国库工厂（API SPEC §33）。
 * EIP-1167 最小代理克隆 + CREATE2（salt = campaignKey，确定性地址，并行执行下存储天然隔离）。
 * campaignKey 全局唯一；treasury 由 ChainCreated 事件对 Indexer 可见。
 */
contract CampaignTreasuryFactory {
    address public immutable treasuryImplementation;

    mapping(bytes32 => address) public getCampaign;
    mapping(bytes32 => bool) public usedCampaignKeys;

    error CampaignKeyZero();
    error CampaignKeyUsed(bytes32 campaignKey);
    error DeployFailed();

    event CampaignCreated(
        bytes32 indexed campaignKey,
        bytes32 indexed impactKey,
        address indexed organizer,
        address treasury
    );

    constructor() {
        treasuryImplementation = address(new CampaignTreasury());
    }

    function createCampaign(bytes32 campaignKey, bytes32 impactKey) external returns (address treasury) {
        if (campaignKey == bytes32(0)) revert CampaignKeyZero();
        if (usedCampaignKeys[campaignKey]) revert CampaignKeyUsed(campaignKey);

        bytes20 impl = bytes20(treasuryImplementation);
        bytes memory code = abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73",
            impl,
            hex"5af43d82803e903d91602b57fd5bf3"
        );

        assembly {
            treasury := create2(0, add(code, 0x20), mload(code), campaignKey)
        }
        if (treasury == address(0)) revert DeployFailed();

        usedCampaignKeys[campaignKey] = true;
        getCampaign[campaignKey] = treasury;

        CampaignTreasury(treasury).initialize(msg.sender);

        emit CampaignCreated(campaignKey, impactKey, msg.sender, treasury);
    }
}
