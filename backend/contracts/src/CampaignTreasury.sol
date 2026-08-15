// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "./ReentrancyGuard.sol";

/**
 * CampaignTreasury — 每个 Campaign 独立国库（API SPEC §32）。
 * 经 CampaignTreasuryFactory 以 EIP-1167 克隆部署（per-campaign 存储隔离，并行执行友好）。
 * 守恒（SPEC §57）：raised = spent + remaining。
 * spend 仅 organizer，CEI + 防重入，事件携带 purpose/evidence 锚。
 */
contract CampaignTreasury is ReentrancyGuard {
    address public organizer;
    uint256 public totalRaised;
    uint256 public totalSpent;

    error NotOrganizer(address caller);
    error ZeroAmount();
    error ZeroRecipient();
    error InsufficientRemaining(uint256 requested, uint256 available);
    error TransferFailed();
    error AlreadyInitialized();

    event CampaignFunded(address indexed supporter, uint256 amount);

    event CampaignSpent(
        address indexed recipient,
        uint256 amount,
        bytes32 indexed purposeHash,
        bytes32 evidenceHash
    );

    /// 实现合约自身锁定：organizer = address(1)，真实 organizer 由 factory 在克隆上 initialize
    constructor() {
        organizer = address(1);
    }

    function initialize(address _organizer) external {
        if (organizer != address(0)) revert AlreadyInitialized();
        organizer = _organizer;
    }

    function fund() external payable {
        if (msg.value == 0) revert ZeroAmount();
        totalRaised += msg.value;
        emit CampaignFunded(msg.sender, msg.value);
    }

    function spend(address recipient, uint256 amount, bytes32 purposeHash, bytes32 evidenceHash)
        external
        onlyOrganizer
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroRecipient();
        uint256 available = totalRaised - totalSpent;
        if (amount > available) revert InsufficientRemaining(amount, available);

        totalSpent += amount; // effect 先行（CEI）

        (bool ok,) = payable(recipient).call{value: amount}(""); // interaction
        if (!ok) revert TransferFailed();

        emit CampaignSpent(recipient, amount, purposeHash, evidenceHash);
    }

    function raised() external view returns (uint256) {
        return totalRaised;
    }

    function spent() external view returns (uint256) {
        return totalSpent;
    }

    function remaining() external view returns (uint256) {
        return totalRaised - totalSpent;
    }

    modifier onlyOrganizer() {
        if (msg.sender != organizer) revert NotOrganizer(msg.sender);
        _;
    }
}
