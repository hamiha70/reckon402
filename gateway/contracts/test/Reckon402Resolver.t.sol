// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test, console } from "forge-std/Test.sol";
import { Reckon402Resolver } from "../Reckon402Resolver.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract Reckon402ResolverTest is Test {

    Reckon402Resolver internal resolver;

    address internal owner;
    uint256 internal signerPk;
    address internal signer;

    string[] internal urls;

    function setUp() public {
        owner = makeAddr("owner");
        signerPk = 0xA11CE;
        signer = vm.addr(signerPk);

        urls = new string[](1);
        urls[0] = "https://gateway.reckon402.com/lookup/{sender}/{data}";

        vm.prank(owner);
        resolver = new Reckon402Resolver(urls, signer);
    }

    // ─── Helper: build a valid signed response ──────────────────────────

    function _signResponse(
        bytes memory result,
        uint64 timestamp,
        bytes32 nonce,
        bytes memory extraData,
        uint256 pk
    ) internal pure returns (bytes memory sig) {
        bytes32 digest = keccak256(abi.encode(result, timestamp, nonce, extraData));
        bytes32 ethDigest = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethDigest);
        sig = abi.encodePacked(r, s, v);
    }

    function _buildResponse(
        bytes memory result,
        uint64 timestamp,
        bytes32 nonce,
        bytes memory extraData,
        uint256 pk
    ) internal pure returns (bytes memory response) {
        bytes memory sig = _signResponse(result, timestamp, nonce, extraData, pk);
        response = abi.encode(result, timestamp, nonce, sig);
    }

    // ─── resolve() tests ────────────────────────────────────────────────

    function test_resolve_revertsWithOffchainLookup() public {
        bytes memory name = bytes("example.eth");
        bytes memory data = bytes("somedata");

        vm.expectRevert();  // OffchainLookup revert
        resolver.resolve(name, data);
    }

    function test_resolve_callDataEncodesCallerEOA() public {
        address caller = makeAddr("caller");
        bytes memory name = bytes("test.eth");
        bytes memory data = abi.encodeWithSignature("text(bytes32,string)", bytes32(0), "x402.pricing");

        bytes memory expectedPayload = abi.encode(name, caller, data);

        vm.prank(caller);
        try resolver.resolve(name, data) {} catch (bytes memory revertData) {
            // Decode the OffchainLookup revert
            // selector: bytes4(keccak256("OffchainLookup(address,string[],bytes,bytes4,bytes)"))
            bytes memory slicedData = new bytes(revertData.length - 4);
            for (uint i = 4; i < revertData.length; i++) {
                slicedData[i - 4] = revertData[i];
            }
            (
                address revertSender,
                string[] memory revertUrls,
                bytes memory callData,
                bytes4 callbackSel,
                bytes memory extraData
            ) = abi.decode(slicedData, (address, string[], bytes, bytes4, bytes));

            assertEq(revertSender, address(resolver));
            assertEq(callData, expectedPayload);
            assertEq(extraData, expectedPayload);
            assertEq(revertUrls[0], urls[0]);
            assertEq(callbackSel, resolver.resolveCallback.selector);
        }
    }

    // ─── resolveCallback() tests ────────────────────────────────────────

    function test_resolveCallback_validSig_returnsData() public {
        bytes memory result = abi.encode("https://facilitator.reckon402.com");
        bytes memory extraData = abi.encode("name", address(this), "data");
        uint64 timestamp = uint64(block.timestamp);
        bytes32 nonce = bytes32(uint256(42));

        bytes memory response = _buildResponse(result, timestamp, nonce, extraData, signerPk);

        bytes memory returned = resolver.resolveCallback(response, extraData);
        assertEq(returned, result);
    }

    function test_resolveCallback_unauthorizedSigner_reverts() public {
        bytes memory result = abi.encode("some data");
        bytes memory extraData = abi.encode("extra");
        uint64 timestamp = uint64(block.timestamp);
        bytes32 nonce = bytes32(uint256(1));

        uint256 badPk = 0xBAD;
        bytes memory response = _buildResponse(result, timestamp, nonce, extraData, badPk);

        address badAddr = vm.addr(badPk);
        vm.expectRevert(abi.encodeWithSelector(Reckon402Resolver.UnauthorizedSigner.selector, badAddr));
        resolver.resolveCallback(response, extraData);
    }

    function test_resolveCallback_staleTimestamp_reverts() public {
        bytes memory result = abi.encode("stale data");
        bytes memory extraData = abi.encode("extra");
        uint64 staleTimestamp = uint64(block.timestamp - resolver.FRESHNESS_WINDOW() - 1);
        bytes32 nonce = bytes32(uint256(99));

        bytes memory response = _buildResponse(result, staleTimestamp, nonce, extraData, signerPk);

        vm.expectRevert(
            abi.encodeWithSelector(
                Reckon402Resolver.StaleResponse.selector,
                staleTimestamp,
                resolver.FRESHNESS_WINDOW()
            )
        );
        resolver.resolveCallback(response, extraData);
    }

    function test_resolveCallback_corruptedExtraData_reverts() public {
        bytes memory result = abi.encode("real data");
        bytes memory extraData = abi.encode("original extra");
        uint64 timestamp = uint64(block.timestamp);
        bytes32 nonce = bytes32(uint256(7));

        // Sign with the correct extraData
        bytes memory response = _buildResponse(result, timestamp, nonce, extraData, signerPk);

        // But pass wrong extraData to the callback — digest mismatch → recovered address ≠ signer
        bytes memory corruptedExtra = abi.encode("different extra");
        vm.expectRevert(); // UnauthorizedSigner (recover returns wrong address)
        resolver.resolveCallback(response, corruptedExtra);
    }

    // ─── Admin tests ────────────────────────────────────────────────────

    function test_addSigner_notOwner_reverts() public {
        address attacker = makeAddr("attacker");
        address newSigner = makeAddr("newSigner");

        vm.prank(attacker);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        resolver.addSigner(newSigner);
    }

    function test_addSigner_onlyOwner_authorizes() public {
        address newSigner = makeAddr("newSigner");
        assertFalse(resolver.signers(newSigner));

        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit Reckon402Resolver.SignerAdded(newSigner);
        resolver.addSigner(newSigner);

        assertTrue(resolver.signers(newSigner));
    }

    function test_removeSigner_onlyOwner() public {
        assertTrue(resolver.signers(signer));

        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit Reckon402Resolver.SignerRemoved(signer);
        resolver.removeSigner(signer);

        assertFalse(resolver.signers(signer));
    }

    function test_setGatewayUrls_onlyOwner_emitsEvent() public {
        string[] memory newUrls = new string[](2);
        newUrls[0] = "https://gateway.reckon402.com/lookup/{sender}/{data}";
        newUrls[1] = "https://gateway-staging.reckon402.com/lookup/{sender}/{data}";

        vm.prank(owner);
        vm.expectEmit(false, false, false, false);
        emit Reckon402Resolver.GatewayUrlsUpdated(newUrls);
        resolver.setGatewayUrls(newUrls);
    }

    function test_setGatewayUrls_notOwner_reverts() public {
        address attacker = makeAddr("attacker");
        string[] memory newUrls = new string[](1);
        newUrls[0] = "https://evil.com/lookup/{sender}/{data}";

        vm.prank(attacker);
        vm.expectRevert();
        resolver.setGatewayUrls(newUrls);
    }

    function test_supportsInterface_extendedResolver() public view {
        // IExtendedResolver.interfaceId = bytes4(keccak256("resolve(bytes,bytes)"))
        bytes4 extendedResolverInterface = bytes4(keccak256("resolve(bytes,bytes)"));
        assertTrue(resolver.supportsInterface(extendedResolverInterface));
    }

    function test_supportsInterface_erc165() public view {
        assertTrue(resolver.supportsInterface(type(IERC165Mini).interfaceId));
    }

    // ─── Signer rotation test ─────────────────────────────────────────

    function test_signerRotation_newSignerAccepted() public {
        uint256 newSignerPk = 0xDEAD;
        address newSigner = vm.addr(newSignerPk);

        vm.prank(owner);
        resolver.addSigner(newSigner);

        bytes memory result = abi.encode("rotated");
        bytes memory extraData = abi.encode("extra");
        uint64 timestamp = uint64(block.timestamp);
        bytes32 nonce = bytes32(uint256(11));

        bytes memory response = _buildResponse(result, timestamp, nonce, extraData, newSignerPk);
        bytes memory returned = resolver.resolveCallback(response, extraData);
        assertEq(returned, result);
    }

    // ─── Fuzz test ────────────────────────────────────────────────────

    function testFuzz_resolveCallback_anyValidSig(
        bytes calldata result,
        bytes32 nonce
    ) public {
        bytes memory extraData = abi.encode("fuzz extra");
        uint64 timestamp = uint64(block.timestamp);

        bytes memory response = _buildResponse(result, timestamp, nonce, extraData, signerPk);
        bytes memory returned = resolver.resolveCallback(response, extraData);
        assertEq(returned, result);
    }
}

// Minimal IERC165 interface for supportsInterface assertion
interface IERC165Mini {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
