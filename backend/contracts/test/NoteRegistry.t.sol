// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {NoteRegistry} from "../src/NoteRegistry.sol";
import {SupportRouter} from "../src/SupportRouter.sol";

contract NoteRegistryTest is Test {
    NoteRegistry registry;
    address alice = makeAddr("alice");
    bytes32 constant NOTE_KEY = keccak256("note-1");
    bytes32 constant CONTENT_HASH = keccak256("manifest-1");

    function setUp() public {
        registry = new NoteRegistry();
    }

    function test_Register_And_GetNote() public {
        vm.prank(alice);
        registry.registerNote(NOTE_KEY, CONTENT_HASH, "https://manifest/1");

        (address creator, bytes32 contentHash, string memory uri, uint64 at) = registry.getNote(NOTE_KEY);
        assertEq(creator, alice);
        assertEq(contentHash, CONTENT_HASH);
        assertEq(uri, "https://manifest/1");
        assertGt(at, 0);
        assertTrue(registry.isRegistered(NOTE_KEY));
    }

    function test_Duplicate_NoteKey_Reverts() public {
        registry.registerNote(NOTE_KEY, CONTENT_HASH, "uri");
        vm.expectRevert(abi.encodeWithSelector(NoteRegistry.NoteKeyAlreadyRegistered.selector, NOTE_KEY));
        registry.registerNote(NOTE_KEY, CONTENT_HASH, "uri2");
    }

    function test_Zero_Key_Or_Hash_Reverts() public {
        vm.expectRevert(NoteRegistry.NoteKeyZero.selector);
        registry.registerNote(bytes32(0), CONTENT_HASH, "uri");
        vm.expectRevert(NoteRegistry.ContentHashZero.selector);
        registry.registerNote(NOTE_KEY, bytes32(0), "uri");
    }

    function test_Event_NoteRegistered() public {
        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit NoteRegistered(NOTE_KEY, alice, CONTENT_HASH, "https://m");
        registry.registerNote(NOTE_KEY, CONTENT_HASH, "https://m");
    }

    event NoteRegistered(bytes32 indexed noteKey, address indexed creator, bytes32 indexed contentHash, string manifestURI);
}

contract SupportRouterTest is Test {
    SupportRouter router;
    address feeRecipient = makeAddr("fee");
    address creator = makeAddr("creator");
    address fan = makeAddr("fan");
    bytes32 constant NOTE_KEY = keccak256("note-1");

    function setUp() public {
        router = new SupportRouter(200, feeRecipient); // 2%
    }

    function test_Tip_Conservation() public {
        vm.deal(fan, 1 ether);
        vm.prank(fan);
        router.tipNative{value: 0.1 ether}(NOTE_KEY, creator);

        // SPEC §57：gross = creator + fee
        (uint256 creatorAmount, uint256 protocolFee) = router.previewTip(0.1 ether);
        assertEq(creatorAmount, 0.098 ether);
        assertEq(protocolFee, 0.002 ether);
        assertEq(router.claimable(creator), 0.098 ether);
        assertEq(router.claimable(feeRecipient), 0.002 ether);
        assertEq(creatorAmount + protocolFee, 0.1 ether);
    }

    function test_Withdraw_Pays_Out() public {
        vm.deal(fan, 1 ether);
        vm.prank(fan);
        router.tipNative{value: 1 ether}(NOTE_KEY, creator);

        uint256 before = creator.balance;
        vm.prank(creator);
        router.withdraw();
        assertEq(creator.balance - before, 0.98 ether);
        assertEq(router.claimable(creator), 0);
    }

    function test_Zero_Tip_Reverts() public {
        vm.expectRevert(SupportRouter.ZeroAmount.selector);
        router.tipNative(NOTE_KEY, creator);
    }

    function test_FeeBps_Updatable_Only_By_Owner() public {
        router.setFeeBps(500);
        assertEq(router.feeBps(), 500);

        vm.prank(fan);
        vm.expectRevert(SupportRouter.NotOwner.selector);
        router.setFeeBps(0);
    }

    function test_Fuzz_Tip_Conservation(uint128 gross) public {
        vm.assume(gross > 0);
        vm.deal(fan, uint256(gross));
        (uint256 creatorAmount, uint256 protocolFee) = router.previewTip(uint256(gross));
        assertEq(creatorAmount + protocolFee, uint256(gross));
    }
}
