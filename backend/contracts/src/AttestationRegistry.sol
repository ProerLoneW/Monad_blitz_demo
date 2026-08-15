// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * AttestationRegistry — 参与者/目击者证明（API SPEC §31）。
 * MVP 规则：(impactKey, attester, type) 唯一，禁止重复；revoke/supersede 留 P1。
 */
contract AttestationRegistry {
    enum AttestationType {
        Participated,
        Witnessed
    }

    // impactKey => attester => type => attested
    mapping(bytes32 => mapping(address => mapping(uint8 => bool))) public hasAttestedMap;

    error ImpactKeyZero();
    error InvalidAttestationType(uint8 given);
    error AlreadyAttested(bytes32 impactKey, uint8 attestationType);

    event Attested(
        bytes32 indexed impactKey,
        address indexed attester,
        uint8 indexed attestationType,
        bytes32 statementHash
    );

    function attest(bytes32 impactKey, uint8 attestationType, bytes32 statementHash) external {
        if (impactKey == bytes32(0)) revert ImpactKeyZero();
        if (attestationType > uint8(type(AttestationType).max)) revert InvalidAttestationType(attestationType);
        if (hasAttestedMap[impactKey][msg.sender][attestationType]) {
            revert AlreadyAttested(impactKey, attestationType);
        }

        hasAttestedMap[impactKey][msg.sender][attestationType] = true;

        emit Attested(impactKey, msg.sender, attestationType, statementHash);
    }

    function hasAttested(bytes32 impactKey, address attester, uint8 attestationType) external view returns (bool) {
        return hasAttestedMap[impactKey][attester][attestationType];
    }
}
