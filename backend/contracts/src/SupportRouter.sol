// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "./ReentrancyGuard.sol";

/**
 * SupportRouter — Direct Tip（API SPEC §28）。
 * credit + withdraw（pull payment）模式：tip 即时记账 credit，不即时转账（SPEC §28.2 推荐）。
 * 资金不变量（SPEC §57）：gross = creatorAmount + protocolFee。
 * feeBps 可由协议管理员调整（PRD §30.1：费率不写死在合约里）。
 */
contract SupportRouter is ReentrancyGuard {
    uint16 public feeBps;
    address public feeRecipient;
    address public owner;

    mapping(address => uint256) public credits;

    error ZeroAmount();
    error ZeroAddress();
    error ZeroFeeRecipient();
    error InvalidFeeBps();
    error NotOwner();
    error NothingToWithdraw();
    error WithdrawFailed();

    event TipSent(
        bytes32 indexed noteKey,
        address indexed supporter,
        address indexed creator,
        uint256 grossAmount,
        uint256 protocolFee,
        uint256 creatorAmount
    );

    event CreditWithdrawn(address indexed account, uint256 amount);

    event FeeUpdated(uint16 oldBps, uint16 newBps);

    constructor(uint16 _feeBps, address _feeRecipient) {
        if (_feeRecipient == address(0)) revert ZeroFeeRecipient();
        if (uint256(_feeBps) > 10_000) revert InvalidFeeBps();
        feeBps = _feeBps;
        feeRecipient = _feeRecipient;
        owner = msg.sender;
    }

    function tipNative(bytes32 noteKey, address creator) external payable {
        if (msg.value == 0) revert ZeroAmount();
        if (creator == address(0)) revert ZeroAddress();

        (uint256 creatorAmount, uint256 protocolFee) = previewTip(msg.value);
        credits[creator] += creatorAmount;
        credits[feeRecipient] += protocolFee;

        emit TipSent(noteKey, msg.sender, creator, msg.value, protocolFee, creatorAmount);
    }

    function previewTip(uint256 grossAmount)
        public
        view
        returns (uint256 creatorAmount, uint256 protocolFee)
    {
        protocolFee = (grossAmount * feeBps) / 10_000;
        creatorAmount = grossAmount - protocolFee;
    }

    function withdraw() external nonReentrant {
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        credits[msg.sender] = 0;

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert WithdrawFailed();

        emit CreditWithdrawn(msg.sender, amount);
    }

    function claimable(address account) external view returns (uint256) {
        return credits[account];
    }

    // ── 协议管理（最小化）─────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setFeeBps(uint16 newBps) external onlyOwner {
        if (uint256(newBps) > 10_000) revert InvalidFeeBps();
        emit FeeUpdated(feeBps, newBps);
        feeBps = newBps;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        feeRecipient = newRecipient;
    }
}
