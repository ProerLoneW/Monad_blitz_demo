// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * 经典存储位防重入（SPEC §37）。
 * 不使用 transient storage，保持与 Monad 环境最大兼容。
 */
abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    uint256 private _status = _NOT_ENTERED;

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}
