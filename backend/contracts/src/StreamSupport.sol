// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "./ReentrancyGuard.sol";

/**
 * StreamSupport — 按秒流式支持（API SPEC §29）。
 *
 * 计提口径（SPEC §29.2 / 后端文档 §5.6）：
 *   accrued = min(accruedStored + activeElapsed * ratePerSecond, budget)
 *   PAUSED 不增长；budget 封顶防忘记停止。
 *
 * 结算守恒（SPEC §57）：
 *   budget = creatorCredit + protocolFee + fanRefund
 *
 * 结算模式：settle 只记账 credits（pull payment），任何人可触发 settleExpired
 * 清理已耗尽的 stream，防止长期占用托管余额。
 */
contract StreamSupport is ReentrancyGuard {
    enum StreamStatus {
        Active,
        Paused,
        Settled
    }

    struct Stream {
        address fan;
        address creator;
        bytes32 noteKey;
        uint128 ratePerSecond;
        uint128 budget;
        uint128 accruedStored;
        uint64 activeSince;
        StreamStatus status;
    }

    uint256 public nextStreamId = 1;
    uint16 public protocolFeeBps;
    address public feeRecipient;

    mapping(uint256 => Stream) private _streams;
    mapping(address => uint256) public credits;

    error ZeroAddress();
    error ZeroRate();
    error ZeroBudget();
    error BudgetBelowRate();
    error BudgetTooLarge();
    error StreamNotFound(uint256 streamId);
    error NotFan(address caller);
    error NotActive();
    error NotPaused();
    error AlreadySettled();
    error NotExpired();
    error NothingToWithdraw();
    error WithdrawFailed();
    error InvalidFeeBps();

    event StreamCreated(
        uint256 indexed streamId,
        bytes32 indexed noteKey,
        address indexed fan,
        address creator,
        uint256 ratePerSecond,
        uint256 budget
    );

    event StreamPaused(uint256 indexed streamId, uint256 accrued);

    event StreamResumed(uint256 indexed streamId);

    event StreamSettled(
        uint256 indexed streamId,
        uint256 accrued,
        uint256 creatorCredit,
        uint256 fanRefund,
        uint256 protocolFee
    );

    event CreditWithdrawn(address indexed account, uint256 amount);

    constructor(uint16 _protocolFeeBps, address _feeRecipient) {
        if (uint256(_protocolFeeBps) > 10_000) revert InvalidFeeBps();
        if (_feeRecipient == address(0)) revert ZeroAddress();
        protocolFeeBps = _protocolFeeBps;
        feeRecipient = _feeRecipient;
    }

    function createStream(bytes32 noteKey, address creator, uint128 ratePerSecond)
        external
        payable
        returns (uint256 streamId)
    {
        if (creator == address(0)) revert ZeroAddress();
        if (ratePerSecond == 0) revert ZeroRate();
        if (msg.value == 0) revert ZeroBudget();
        if (msg.value < ratePerSecond) revert BudgetBelowRate(); // 至少覆盖 1 秒；≥10s 由后端校验
        if (msg.value > type(uint128).max) revert BudgetTooLarge();

        streamId = nextStreamId++;
        _streams[streamId] = Stream({
            fan: msg.sender,
            creator: creator,
            noteKey: noteKey,
            ratePerSecond: ratePerSecond,
            budget: uint128(msg.value),
            accruedStored: 0,
            activeSince: uint64(block.timestamp),
            status: StreamStatus.Active
        });

        emit StreamCreated(streamId, noteKey, msg.sender, creator, ratePerSecond, msg.value);
    }

    function pauseStream(uint256 streamId) external {
        Stream storage s = _requireStream(streamId);
        if (s.fan != msg.sender) revert NotFan(msg.sender);
        if (s.status != StreamStatus.Active) revert NotActive();

        uint128 accrued = _accrued(s);
        s.accruedStored = accrued;
        s.activeSince = 0;
        s.status = StreamStatus.Paused;

        emit StreamPaused(streamId, accrued);
    }

    function resumeStream(uint256 streamId) external {
        Stream storage s = _requireStream(streamId);
        if (s.fan != msg.sender) revert NotFan(msg.sender);
        if (s.status != StreamStatus.Paused) revert NotPaused();

        s.activeSince = uint64(block.timestamp);
        s.status = StreamStatus.Active;

        emit StreamResumed(streamId);
    }

    function stopAndSettle(uint256 streamId) external {
        Stream storage s = _requireStream(streamId);
        if (s.fan != msg.sender) revert NotFan(msg.sender);
        if (s.status == StreamStatus.Settled) revert AlreadySettled();

        _settle(s, streamId);
    }

    /// 任何人可触发：仅限 Active 且已耗尽（accrued == budget）的 stream
    function settleExpired(uint256 streamId) external {
        Stream storage s = _requireStream(streamId);
        if (s.status != StreamStatus.Active) revert NotActive();
        if (_accrued(s) < s.budget) revert NotExpired();

        _settle(s, streamId);
    }

    function previewStream(uint256 streamId)
        external
        view
        returns (uint256 accrued, uint256 remainingBudget, uint256 estimatedEndTime, uint8 status)
    {
        Stream storage s = _requireStream(streamId);
        uint256 acc = _accrued(s);
        uint256 remaining = uint256(s.budget) - acc;
        uint256 endTime = 0;
        if (s.status == StreamStatus.Active) {
            endTime = block.timestamp + remaining / s.ratePerSecond;
        }
        return (acc, remaining, endTime, uint8(s.status));
    }

    function claimable(address account) external view returns (uint256) {
        return credits[account];
    }

    function getStream(uint256 streamId)
        external
        view
        returns (
            address fan,
            address creator,
            bytes32 noteKey,
            uint128 ratePerSecond,
            uint128 budget,
            uint128 accruedStored,
            uint64 activeSince,
            uint8 status
        )
    {
        Stream storage s = _requireStream(streamId);
        return (s.fan, s.creator, s.noteKey, s.ratePerSecond, s.budget, s.accruedStored, s.activeSince, uint8(s.status));
    }

    function withdraw() external nonReentrant {
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        credits[msg.sender] = 0;

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert WithdrawFailed();

        emit CreditWithdrawn(msg.sender, amount);
    }

    // ── 内部 ─────────────────────────────────────────────

    function _requireStream(uint256 streamId) private view returns (Stream storage) {
        Stream storage s = _streams[streamId];
        if (streamId == 0 || s.fan == address(0)) revert StreamNotFound(streamId);
        return s;
    }

    function _accrued(Stream storage s) private view returns (uint128) {
        if (s.status == StreamStatus.Active && s.activeSince != 0) {
            uint256 elapsed = block.timestamp - s.activeSince; // uint64 秒
            uint256 acc = uint256(s.accruedStored) + elapsed * uint256(s.ratePerSecond);
            return acc >= s.budget ? s.budget : uint128(acc);
        }
        return s.accruedStored;
    }

    function _settle(Stream storage s, uint256 streamId) private {
        uint256 total = _accrued(s);
        uint256 fee = (total * protocolFeeBps) / 10_000;
        uint256 creatorCredit = total - fee;
        uint256 refund = uint256(s.budget) - total;

        s.status = StreamStatus.Settled;
        s.accruedStored = uint128(total);
        s.activeSince = 0;

        credits[s.creator] += creatorCredit;
        credits[s.fan] += refund;
        credits[feeRecipient] += fee;

        // 守恒：creatorCredit + fee + refund == budget（构造保证）
        emit StreamSettled(streamId, total, creatorCredit, refund, fee);
    }
}
