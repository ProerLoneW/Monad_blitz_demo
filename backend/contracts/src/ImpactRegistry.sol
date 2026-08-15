// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * ImpactRegistry — Impact Claim 与证据清单锚定（API SPEC §30）。
 * claimHash 不可变；evidence manifest 版本只能追加（version 单调递增），
 * 历史版本经事件可追溯；敏感数据禁止上链（链下责任，合约只收 hash/URI）。
 */
contract ImpactRegistry {
    mapping(bytes32 => address) private _owners;
    mapping(bytes32 => uint32) public currentVersion;

    error ImpactKeyZero();
    error ClaimHashZero();
    error ImpactAlreadyRegistered(bytes32 impactKey);
    error NotImpactOwner(bytes32 impactKey);
    error InvalidVersion(uint32 expected, uint32 given);

    event ImpactRegistered(
        bytes32 indexed impactKey,
        bytes32 indexed noteKey,
        address indexed creator,
        bytes32 claimHash,
        bytes32 evidenceManifestHash,
        string manifestURI
    );

    event EvidenceManifestUpdated(
        bytes32 indexed impactKey,
        uint32 version,
        bytes32 evidenceManifestHash,
        string manifestURI
    );

    function registerImpact(
        bytes32 impactKey,
        bytes32 noteKey,
        bytes32 claimHash,
        bytes32 evidenceManifestHash,
        string calldata manifestURI
    ) external {
        if (impactKey == bytes32(0)) revert ImpactKeyZero();
        if (claimHash == bytes32(0)) revert ClaimHashZero();
        if (_owners[impactKey] != address(0)) revert ImpactAlreadyRegistered(impactKey);

        _owners[impactKey] = msg.sender;
        currentVersion[impactKey] = 1;

        emit ImpactRegistered(impactKey, noteKey, msg.sender, claimHash, evidenceManifestHash, manifestURI);
    }

    function updateEvidenceManifest(
        bytes32 impactKey,
        uint32 version,
        bytes32 evidenceManifestHash,
        string calldata manifestURI
    ) external {
        if (_owners[impactKey] != msg.sender) revert NotImpactOwner(impactKey);
        uint32 expected = currentVersion[impactKey] + 1;
        if (version != expected) revert InvalidVersion(expected, version);

        currentVersion[impactKey] = version;

        emit EvidenceManifestUpdated(impactKey, version, evidenceManifestHash, manifestURI);
    }

    function ownerOfImpact(bytes32 impactKey) external view returns (address) {
        return _owners[impactKey];
    }
}
