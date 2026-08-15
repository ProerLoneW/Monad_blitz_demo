// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * NoteRegistry — 内容所有权锚定（API SPEC §27）。
 * 链上只存 provenance：creator / contentHash / manifestURI / 时间。
 * 不存内容本体；noteKey 全局唯一；creator = msg.sender。
 */
contract NoteRegistry {
    struct Note {
        address creator;
        bytes32 contentHash;
        string manifestURI;
        uint64 registeredAt;
    }

    error NoteKeyZero();
    error ContentHashZero();
    error NoteKeyAlreadyRegistered(bytes32 noteKey);

    event NoteRegistered(
        bytes32 indexed noteKey,
        address indexed creator,
        bytes32 indexed contentHash,
        string manifestURI
    );

    mapping(bytes32 => Note) private _notes;
    mapping(bytes32 => bool) private _registered;

    function registerNote(bytes32 noteKey, bytes32 contentHash, string calldata manifestURI) external {
        if (noteKey == bytes32(0)) revert NoteKeyZero();
        if (contentHash == bytes32(0)) revert ContentHashZero();
        if (_registered[noteKey]) revert NoteKeyAlreadyRegistered(noteKey);

        _registered[noteKey] = true;
        _notes[noteKey] = Note({
            creator: msg.sender,
            contentHash: contentHash,
            manifestURI: manifestURI,
            registeredAt: uint64(block.timestamp)
        });

        emit NoteRegistered(noteKey, msg.sender, contentHash, manifestURI);
    }

    function getNote(bytes32 noteKey)
        external
        view
        returns (address creator, bytes32 contentHash, string memory manifestURI, uint64 registeredAt)
    {
        Note storage n = _notes[noteKey];
        return (n.creator, n.contentHash, n.manifestURI, n.registeredAt);
    }

    function isRegistered(bytes32 noteKey) external view returns (bool) {
        return _registered[noteKey];
    }
}
