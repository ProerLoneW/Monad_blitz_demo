// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ImpactRegistry} from "../src/ImpactRegistry.sol";
import {AttestationRegistry} from "../src/AttestationRegistry.sol";
import {CampaignTreasury} from "../src/CampaignTreasury.sol";
import {CampaignTreasuryFactory} from "../src/CampaignTreasuryFactory.sol";

contract ImpactAndAttestationTest is Test {
    ImpactRegistry impactRegistry;
    AttestationRegistry attestationRegistry;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    bytes32 constant IMPACT_KEY = keccak256("impact-1");
    bytes32 constant NOTE_KEY = keccak256("note-1");
    bytes32 constant CLAIM_HASH = keccak256("claim");
    bytes32 constant EVIDENCE_V1 = keccak256("ev-v1");
    bytes32 constant EVIDENCE_V2 = keccak256("ev-v2");

    function setUp() public {
        impactRegistry = new ImpactRegistry();
        attestationRegistry = new AttestationRegistry();
    }

    function test_Register_Impact() public {
        vm.prank(alice);
        impactRegistry.registerImpact(IMPACT_KEY, NOTE_KEY, CLAIM_HASH, EVIDENCE_V1, "https://m");
        assertEq(impactRegistry.ownerOfImpact(IMPACT_KEY), alice);
        assertEq(impactRegistry.currentVersion(IMPACT_KEY), 1);
    }

    function test_Evidence_Version_Must_Be_Monotonic_And_OwnerOnly() public {
        vm.startPrank(alice);
        impactRegistry.registerImpact(IMPACT_KEY, NOTE_KEY, CLAIM_HASH, EVIDENCE_V1, "https://m");

        vm.expectRevert(
            abi.encodeWithSelector(ImpactRegistry.InvalidVersion.selector, 2, 3)
        );
        impactRegistry.updateEvidenceManifest(IMPACT_KEY, 3, EVIDENCE_V2, "https://m2");

        impactRegistry.updateEvidenceManifest(IMPACT_KEY, 2, EVIDENCE_V2, "https://m2");
        assertEq(impactRegistry.currentVersion(IMPACT_KEY), 2);
        vm.stopPrank();

        // 非作者不能更新
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ImpactRegistry.NotImpactOwner.selector, IMPACT_KEY));
        impactRegistry.updateEvidenceManifest(IMPACT_KEY, 3, EVIDENCE_V2, "https://m3");
    }

    function test_Attest_Unique_Per_Impact_Addr_Type() public {
        vm.prank(bob);
        attestationRegistry.attest(IMPACT_KEY, 0, keccak256("stmt")); // Participated
        assertTrue(attestationRegistry.hasAttested(IMPACT_KEY, bob, 0));

        // 同 type 重复 → 拒绝
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(AttestationRegistry.AlreadyAttested.selector, IMPACT_KEY, 0));
        attestationRegistry.attest(IMPACT_KEY, 0, keccak256("stmt2"));

        // 不同 type 允许
        vm.prank(bob);
        attestationRegistry.attest(IMPACT_KEY, 1, keccak256("stmt3")); // Witnessed
        assertTrue(attestationRegistry.hasAttested(IMPACT_KEY, bob, 1));
    }
}

contract CampaignTreasuryTest is Test {
    CampaignTreasuryFactory factory;
    address organizer = makeAddr("organizer");
    address supporter = makeAddr("supporter");
    address supplier = makeAddr("supplier");
    address other = makeAddr("other");

    bytes32 constant CAMPAIGN_KEY = keccak256("campaign-1");
    bytes32 constant IMPACT_KEY = keccak256("impact-1");

    CampaignTreasury treasury;

    function setUp() public {
        factory = new CampaignTreasuryFactory();
        vm.deal(supporter, 100 ether);

        vm.prank(organizer);
        treasury = CampaignTreasury(factory.createCampaign(CAMPAIGN_KEY, IMPACT_KEY));
    }

    function test_Clone_Initialized_With_Organizer() public view {
        assertEq(treasury.organizer(), organizer);
        assertEq(factory.getCampaign(CAMPAIGN_KEY), address(treasury));
    }

    function test_CampaignKey_Unique() public {
        vm.prank(organizer);
        vm.expectRevert(abi.encodeWithSelector(CampaignTreasuryFactory.CampaignKeyUsed.selector, CAMPAIGN_KEY));
        factory.createCampaign(CAMPAIGN_KEY, IMPACT_KEY);
    }

    function test_Fund_And_Spend_Conservation() public {
        vm.prank(supporter);
        treasury.fund{value: 5 ether}();
        assertEq(treasury.raised(), 5 ether);
        assertEq(treasury.remaining(), 5 ether);

        vm.prank(organizer);
        treasury.spend(supplier, 2 ether, keccak256("purpose"), keccak256("evidence"));

        // SPEC §57：raised = spent + remaining
        assertEq(treasury.spent(), 2 ether);
        assertEq(treasury.remaining(), 3 ether);
        assertEq(treasury.raised(), treasury.spent() + treasury.remaining());
        assertEq(supplier.balance, 2 ether);
    }

    function test_Only_Organizer_Can_Spend() public {
        vm.prank(supporter);
        treasury.fund{value: 1 ether}();

        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(CampaignTreasury.NotOrganizer.selector, other));
        treasury.spend(supplier, 0.5 ether, bytes32(0), bytes32(0));
    }

    function test_Overspend_Reverts() public {
        vm.prank(supporter);
        treasury.fund{value: 1 ether}();

        vm.prank(organizer);
        vm.expectRevert(
            abi.encodeWithSelector(CampaignTreasury.InsufficientRemaining.selector, 2 ether, 1 ether)
        );
        treasury.spend(supplier, 2 ether, bytes32(0), bytes32(0));
    }

    function test_Multiple_Campaigns_Isolated() public {
        bytes32 key2 = keccak256("campaign-2");
        vm.prank(other);
        CampaignTreasury t2 = CampaignTreasury(factory.createCampaign(key2, IMPACT_KEY));

        vm.prank(supporter);
        treasury.fund{value: 1 ether}();

        // t2 独立存储：无资金、不同 organizer
        assertEq(t2.raised(), 0);
        assertEq(t2.organizer(), other);
        assertEq(treasury.remaining(), 1 ether);
    }
}
