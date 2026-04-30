// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { Splitter } from "../src/Splitter.sol";
import { IUSDC } from "../src/IUSDC.sol";

/// @dev End-to-end fork test: EIP-3009 transferWithAuthorization (buyer → Splitter)
///      then Splitter.distribute(). Proves the full on-chain L3 settlement path
///      against real USDC on Base Sepolia.
///
///      Gated on env var SPLITTER_FORK_TEST=1; otherwise skipped to keep the
///      default `forge test` run offline and fast.
///
///      Run:
///        SPLITTER_FORK_TEST=1 \
///        BASE_SEPOLIA_RPC_PRIMARY=https://... \
///        forge test --fork-url base_sepolia --match-contract SplitterForkTest -vv
contract SplitterForkTest is Test {
    IUSDC   constant USDC = IUSDC(0x036CbD53842c5426634e7929541eC2318f3dCF7e); // Base Sepolia
    uint256 constant CHAIN_ID = 84532;

    // EIP-3009 TransferWithAuthorization typehash (canonical, per EIP-3009).
    bytes32 constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256(
            "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );

    Splitter public splitter;

    address public seller    = address(0xD53ffac42496d73B3Faf946786688a8454F57b1f);
    address public feeSink   = address(0x0A0228E6a5E1d7Be234A190A8D9A3af9E08ec455);
    address public treasury  = address(0x66C2858D9A8605957c516a77262Eb66EE6be113C);

    uint256 internal buyerPk;
    address internal buyer;

    function setUp() public {
        if (!_forkEnabled()) return;

        buyerPk = 0xA11CE_ABCDEF; // test-only key
        buyer   = vm.addr(buyerPk);

        address[] memory r = new address[](3);
        r[0] = seller; r[1] = feeSink; r[2] = treasury;
        uint16[] memory b = new uint16[](3);
        b[0] = 9_700; b[1] = 200; b[2] = 100;
        splitter = new Splitter(USDC, r, b);
    }

    function test_forkE2E_transferWithAuthorization_then_distribute() public {
        if (!_forkEnabled()) { emit log("skipped: SPLITTER_FORK_TEST not set"); return; }

        // Fund the buyer with USDC via storage write (FiatTokenV2_2 balanceOf mapping is not
        // at a stable storage slot across implementations — use deal() instead).
        uint256 amount = 10_000; // 0.01 USDC base units
        deal(address(USDC), buyer, amount);
        assertEq(USDC.balanceOf(buyer), amount);

        // Build EIP-3009 authorization, signed by the buyer.
        uint256 validAfter  = 0;
        uint256 validBefore = block.timestamp + 600;
        bytes32 nonce       = keccak256(abi.encodePacked(buyer, block.timestamp, uint256(1)));

        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
            buyer,
            address(splitter),
            amount,
            validAfter,
            validBefore,
            nonce
        ));

        // Read live domain separator from the deployed USDC contract (avoids
        // drift with name/version/chainId reconstruction).
        bytes32 domainSeparator = USDC.DOMAIN_SEPARATOR();
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerPk, digest);

        // Facilitator submits transferWithAuthorization (buyer → Splitter).
        vm.prank(address(0xFACE));
        USDC.transferWithAuthorization(
            buyer,
            address(splitter),
            amount,
            validAfter,
            validBefore,
            nonce,
            v, r, s
        );

        assertEq(USDC.balanceOf(buyer), 0);
        assertEq(USDC.balanceOf(address(splitter)), amount);
        assertTrue(USDC.authorizationState(buyer, nonce), "authorization should be marked used");

        // Snapshot recipient balances before distribute. Production seller/feeSink/treasury
        // EOAs accumulate real USDC from L3/L4b settlements, so the test must assert on
        // DELTAS rather than absolute balances.
        uint256 sellerBefore   = USDC.balanceOf(seller);
        uint256 feeSinkBefore  = USDC.balanceOf(feeSink);
        uint256 treasuryBefore = USDC.balanceOf(treasury);

        // Facilitator calls Splitter.distribute.
        bytes32 paymentId = keccak256(abi.encode("fork-test", nonce));
        splitter.distribute(paymentId, amount);

        assertEq(USDC.balanceOf(seller)   - sellerBefore,   9_700, "seller delta 97%");
        assertEq(USDC.balanceOf(feeSink)  - feeSinkBefore,  200,   "feeSink delta 2%");
        assertEq(USDC.balanceOf(treasury) - treasuryBefore, 100,   "treasury delta 1%");
        assertEq(USDC.balanceOf(address(splitter)), 0, "no dust remaining");
    }

    function _forkEnabled() internal view returns (bool) {
        try vm.envBool("SPLITTER_FORK_TEST") returns (bool on) {
            return on;
        } catch {
            return false;
        }
    }
}
