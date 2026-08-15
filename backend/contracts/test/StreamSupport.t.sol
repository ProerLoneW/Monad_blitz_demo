// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StreamSupport} from "../src/StreamSupport.sol";

/**
 * StreamSupport 状态机与资金守恒测试（SPEC §29 / §57）。
 */
contract StreamSupportTest is Test {
    StreamSupport ss;
    address feeRecipient = makeAddr("fee");
    address creator = makeAddr("creator");
    address fan = makeAddr("fan");
    address anyone = makeAddr("anyone");
    bytes32 constant NOTE_KEY = keccak256("note-1");

    uint128 constant RATE = 0.001 ether; // 1e15 wei/s
    uint128 constant BUDGET = 0.02 ether; // 20s

    function setUp() public {
        ss = new StreamSupport(200, feeRecipient); // 2%
        vm.deal(fan, 10 ether);
    }

    function _create() internal returns (uint256 id) {
        vm.prank(fan);
        id = ss.createStream{value: BUDGET}(NOTE_KEY, creator, RATE);
    }

    // ── 创建 ─────────────────────────────────────────────

    function test_Create_Initial_State() public {
        uint256 id = _create();
        assertEq(id, 1);
        assertEq(ss.nextStreamId(), 2);

        (, address c, bytes32 nk, uint128 rate, uint128 budget,, uint64 since, uint8 status) = ss.getStream(id);
        assertEq(c, creator);
        assertEq(nk, NOTE_KEY);
        assertEq(rate, RATE);
        assertEq(budget, BUDGET);
        assertGt(since, 0);
        assertEq(status, 0); // Active
    }

    function test_Create_Reverts() public {
        vm.prank(fan);
        vm.expectRevert(StreamSupport.ZeroRate.selector);
        ss.createStream{value: BUDGET}(NOTE_KEY, creator, 0);

        vm.prank(fan);
        vm.expectRevert(StreamSupport.BudgetBelowRate.selector);
        ss.createStream{value: RATE - 1}(NOTE_KEY, creator, RATE);

        vm.prank(fan);
        vm.expectRevert(StreamSupport.ZeroAddress.selector);
        ss.createStream{value: BUDGET}(NOTE_KEY, address(0), RATE);
    }

    // ── 计提与暂停 ───────────────────────────────────────

    function test_Accrual_Capped_At_Budget() public {
        uint256 id = _create();
        vm.warp(block.timestamp + 1000); // 远超 20s

        (uint256 accrued, uint256 remaining,,) = ss.previewStream(id);
        assertEq(accrued, BUDGET); // 封顶
        assertEq(remaining, 0);
    }

    function test_Pause_Freezes_Accrual() public {
        uint256 id = _create();
        vm.warp(block.timestamp + 5);

        vm.prank(fan);
        ss.pauseStream(id); // accrued = 5s * RATE
        uint256 frozenAt = block.timestamp;

        vm.warp(block.timestamp + 100);
        (uint256 accrued,,,) = ss.previewStream(id);
        assertEq(accrued, 5 * RATE); // 暂停期间不增长

        (,,,,,,, uint8 status) = ss.getStream(id);
        assertEq(status, 1); // Paused

        // 非 fan 不能 pause/resume
        vm.prank(anyone);
        vm.expectRevert(abi.encodeWithSelector(StreamSupport.NotFan.selector, anyone));
        ss.pauseStream(id);

        frozenAt; // silence
    }

    function test_Resume_Continues_From_Stored() public {
        uint256 id = _create();
        vm.warp(block.timestamp + 5);
        vm.startPrank(fan);
        ss.pauseStream(id); // stored = 5s
        vm.warp(block.timestamp + 100); // 暂停 100s 不计
        ss.resumeStream(id);
        vm.stopPrank();

        vm.warp(block.timestamp + 3);
        (uint256 accrued,,,) = ss.previewStream(id);
        assertEq(accrued, 8 * RATE); // 5 + 3
    }

    // ── 结算与守恒 ───────────────────────────────────────

    function test_StopAndSettle_Conservation() public {
        uint256 id = _create();
        vm.warp(block.timestamp + 7); // 计提 7s

        vm.prank(fan);
        ss.stopAndSettle(id);

        // SPEC §57：budget = creatorCredit + protocolFee + fanRefund
        uint256 creatorCredit = ss.claimable(creator);
        uint256 fee = ss.claimable(feeRecipient);
        uint256 refund = ss.claimable(fan);
        assertEq(creatorCredit + fee + refund, BUDGET);

        uint256 accrued = 7 * RATE;
        uint256 expectFee = (accrued * 200) / 10_000;
        assertEq(creatorCredit, accrued - expectFee);
        assertEq(fee, expectFee);
        assertEq(refund, BUDGET - accrued);

        (,,,,,,, uint8 status) = ss.getStream(id);
        assertEq(status, 2); // Settled

        vm.prank(fan);
        vm.expectRevert(StreamSupport.AlreadySettled.selector);
        ss.stopAndSettle(id);
    }

    function test_SettleExpired_Only_When_Depleted() public {
        uint256 id = _create();

        // 未耗尽：任何人调用都拒绝
        vm.prank(anyone);
        vm.expectRevert(StreamSupport.NotExpired.selector);
        ss.settleExpired(id);

        vm.warp(block.timestamp + 20); // 恰好耗尽
        vm.prank(anyone); // 任何人可触发
        ss.settleExpired(id);

        assertEq(ss.claimable(creator) + ss.claimable(feeRecipient) + ss.claimable(fan), BUDGET);
        uint256 refund = ss.claimable(fan);
        assertEq(refund, 0); // 全额耗尽，无退款
    }

    function test_Withdraw_Credits() public {
        uint256 id = _create();
        vm.warp(block.timestamp + 10);
        vm.prank(fan);
        ss.stopAndSettle(id);

        uint256 before = creator.balance;
        vm.prank(creator);
        ss.withdraw();
        assertGt(creator.balance, before);
        assertEq(ss.claimable(creator), 0);
    }

    // ── Fuzz：任意时间点结算，守恒恒成立 ─────────────────

    function testFuzz_Settle_Conservation(uint64 elapsed, uint128 rate, uint16 bps) public {
        rate = uint128(bound(rate, 1, 1e18));
        bps = uint16(bound(bps, 0, 1000));
        vm.assume(rate <= 0.01 ether); // 控制数值范围

        StreamSupport s2 = new StreamSupport(bps, feeRecipient);
        uint128 budget = uint128(uint256(rate) * 30); // 30s 预算
        vm.deal(fan, 1 ether);

        vm.prank(fan);
        uint256 id = s2.createStream{value: budget}(NOTE_KEY, creator, rate);

        vm.warp(block.timestamp + elapsed);

        vm.prank(fan);
        s2.stopAndSettle(id);

        assertEq(s2.claimable(creator) + s2.claimable(feeRecipient) + s2.claimable(fan), budget);
    }
}
