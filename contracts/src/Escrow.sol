// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 }           from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 }        from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard }  from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IIdentityRegistry }   from "./interfaces/IIdentityRegistry.sol";
import { IReputationRegistry } from "./interfaces/IReputationRegistry.sol";

/// @title  Reckon402 Escrow (v1)
/// @notice Per-agent risk buffer. Receives a slice of every settlement via a
///         Splitter recipient slot. Releases funds to the agent's
///         IdentityRegistry NFT owner, gated on a tier curve evaluated
///         against the agent's facilitator-attested settlement count.
/// @dev    No admin, no upgrade, no rescue. Authority follows the agent NFT —
///         transferring the NFT transfers claim rights. Tier curve is
///         parameterized at deploy time (NOT hardcoded) so the same code can
///         host different schedules.
contract Escrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS_DENOMINATOR = 10_000;

    IERC20  public immutable token;
    address public immutable identityRegistry;
    address public immutable reputationRegistry;
    uint256 public immutable agentId;
    address public immutable facilitatorClient;

    /// @notice Cumulative amount withdrawn over the lifetime of this Escrow.
    ///         Monotonically increasing. Used to cap future withdrawals at
    ///         `releasedAmount() - totalWithdrawn` — the on-chain replay
    ///         guard requested in the L4d spec.
    uint256 public totalWithdrawn;

    // Tier curve, pinned per Escrow at deploy. Stored as plain dynamic
    // arrays + two strings; constructor validates monotonicity + bounds.
    uint8[]  private _tierThresholds;
    uint16[] private _tierReleaseBps;
    string   private _tag1;
    string   private _tag2;

    event Withdrawn(
        address indexed by,
        uint256          amount,
        uint64           attestationCount,
        uint16           releasedBps
    );

    event Deployed(
        address indexed token,
        address indexed identityRegistry,
        address indexed reputationRegistry,
        uint256          agentId,
        address          facilitatorClient,
        uint8[]          tierThresholds,
        uint16[]         tierReleaseBps,
        string           tag1,
        string           tag2
    );

    error NotOwner();
    error NothingToWithdraw();
    error WithdrawAmountExceedsAvailable(uint256 requested, uint256 available);
    error TierLengthsMismatch();
    error TierThresholdsNotMonotonic();
    error TierBpsNotMonotonic();
    error TierBpsExceedsDenominator();
    error ZeroAddress();

    constructor(
        IERC20           token_,
        address          identityRegistry_,
        address          reputationRegistry_,
        uint256          agentId_,
        address          facilitatorClient_,
        uint8[]   memory tierThresholds_,
        uint16[]  memory tierReleaseBps_,
        string    memory tag1_,
        string    memory tag2_
    ) {
        if (
            address(token_) == address(0)            ||
            identityRegistry_ == address(0)          ||
            reputationRegistry_ == address(0)        ||
            facilitatorClient_ == address(0)
        ) revert ZeroAddress();

        uint256 n = tierThresholds_.length;
        if (n == 0 || n != tierReleaseBps_.length) revert TierLengthsMismatch();

        for (uint256 i = 0; i < n; ++i) {
            if (i > 0 && tierThresholds_[i] <= tierThresholds_[i - 1]) {
                revert TierThresholdsNotMonotonic();
            }
            if (tierReleaseBps_[i] > BPS_DENOMINATOR) {
                revert TierBpsExceedsDenominator();
            }
            if (i > 0 && tierReleaseBps_[i] < tierReleaseBps_[i - 1]) {
                revert TierBpsNotMonotonic();
            }
        }

        token              = token_;
        identityRegistry   = identityRegistry_;
        reputationRegistry = reputationRegistry_;
        agentId            = agentId_;
        facilitatorClient  = facilitatorClient_;
        _tierThresholds    = tierThresholds_;
        _tierReleaseBps    = tierReleaseBps_;
        _tag1              = tag1_;
        _tag2              = tag2_;

        emit Deployed(
            address(token_),
            identityRegistry_,
            reputationRegistry_,
            agentId_,
            facilitatorClient_,
            tierThresholds_,
            tierReleaseBps_,
            tag1_,
            tag2_
        );
    }

    // -------------------------------------------------------------------- //
    // Authority resolver                                                   //
    // -------------------------------------------------------------------- //

    /// @notice The currently-authorized owner — `IdentityRegistry.ownerOf(agentId)`.
    /// @dev    Reverts if the NFT has been burned or never minted; this is
    ///         intentional. Withdraw paths inline this same call so a bricked
    ///         NFT also bricks withdraw — surfaced to the caller as a revert.
    function owner() public view returns (address) {
        return IIdentityRegistry(identityRegistry).ownerOf(agentId);
    }

    // -------------------------------------------------------------------- //
    // Counter views                                                        //
    // -------------------------------------------------------------------- //

    /// @notice Total token amount this Escrow has held over its lifetime
    ///         (= currently held + already withdrawn).
    function totalDeposited() public view returns (uint256) {
        return token.balanceOf(address(this)) + totalWithdrawn;
    }

    /// @notice Token still held by this Escrow (= ERC-20 balance, no
    ///         derivation).
    function currentlyHeld() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    // -------------------------------------------------------------------- //
    // Tier evaluation                                                      //
    // -------------------------------------------------------------------- //

    /// @notice Number of facilitator-attested settlements for this agent.
    ///         Reads ReputationRegistry filtered by the constructor-pinned
    ///         facilitatorClient EOA + (tag1, tag2).
    function attestationCount() public view returns (uint64) {
        address[] memory clients = new address[](1);
        clients[0] = facilitatorClient;
        (uint64 count, , ) = IReputationRegistry(reputationRegistry).getSummary(
            agentId,
            clients,
            _tag1,
            _tag2
        );
        return count;
    }

    /// @notice Tier release fraction in BPS (0..10_000) at the current
    ///         attestation count. Walks the monotonic tier table and returns
    ///         the highest qualifying release bps. Returns 0 if count below
    ///         the lowest threshold.
    function releasedBps() public view returns (uint16) {
        uint64 count = attestationCount();
        uint16 best  = 0;
        uint256 n = _tierThresholds.length;
        for (uint256 i = 0; i < n; ++i) {
            if (count >= _tierThresholds[i]) {
                best = _tierReleaseBps[i];
            } else {
                break;
            }
        }
        return best;
    }

    /// @notice Total amount unlocked for withdrawal so far (cumulative cap).
    ///         `withdraw()` enforces `totalWithdrawn + amount <= releasedAmount`.
    function releasedAmount() public view returns (uint256) {
        return (totalDeposited() * releasedBps()) / BPS_DENOMINATOR;
    }

    /// @notice Amount the owner can withdraw right now.
    function withdrawableNow() public view returns (uint256) {
        uint256 cap = releasedAmount();
        if (cap <= totalWithdrawn) return 0;
        return cap - totalWithdrawn;
    }

    // -------------------------------------------------------------------- //
    // Withdraw                                                             //
    // -------------------------------------------------------------------- //

    /// @notice Withdraw `amount` of token to the caller. Only the
    ///         IdentityRegistry NFT owner may call. Amount must not exceed
    ///         `withdrawableNow()`.
    function withdraw(uint256 amount) external nonReentrant {
        address actualOwner = IIdentityRegistry(identityRegistry).ownerOf(agentId);
        if (msg.sender != actualOwner) revert NotOwner();
        if (amount == 0) revert NothingToWithdraw();

        uint256 available = withdrawableNow();
        if (amount > available) {
            revert WithdrawAmountExceedsAvailable(amount, available);
        }

        // CEI: state update before transfer.
        totalWithdrawn += amount;
        token.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount, attestationCount(), releasedBps());
    }

    /// @notice Convenience: withdraw the full `withdrawableNow()` to the
    ///         caller. Reverts if there is nothing to withdraw.
    function withdrawAll() external nonReentrant returns (uint256 amount) {
        address actualOwner = IIdentityRegistry(identityRegistry).ownerOf(agentId);
        if (msg.sender != actualOwner) revert NotOwner();

        amount = withdrawableNow();
        if (amount == 0) revert NothingToWithdraw();

        totalWithdrawn += amount;
        token.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount, attestationCount(), releasedBps());
    }

    // -------------------------------------------------------------------- //
    // Off-chain helpers                                                    //
    // -------------------------------------------------------------------- //

    /// @notice Tier configuration in one call (for dashboard rendering).
    function tierConfig()
        external
        view
        returns (
            uint8[]  memory thresholds,
            uint16[] memory releaseBpsArr,
            string   memory tag1Val,
            string   memory tag2Val
        )
    {
        return (_tierThresholds, _tierReleaseBps, _tag1, _tag2);
    }

    /// @notice One-shot stats getter for the dashboard. All seven values
    ///         pulled in a single eth_call.
    function getStats()
        external
        view
        returns (
            uint256 totalDepositedAmt,
            uint256 currentlyHeldAmt,
            uint256 totalWithdrawnAmt,
            uint256 releasedAmountAmt,
            uint256 withdrawableNowAmt,
            uint64  attestationCountVal,
            uint16  releasedBpsVal
        )
    {
        totalDepositedAmt   = totalDeposited();
        currentlyHeldAmt    = totalDepositedAmt - totalWithdrawn;
        totalWithdrawnAmt   = totalWithdrawn;
        attestationCountVal = attestationCount();
        releasedBpsVal      = releasedBps();
        releasedAmountAmt   = (totalDepositedAmt * releasedBpsVal) / BPS_DENOMINATOR;
        withdrawableNowAmt  = releasedAmountAmt > totalWithdrawnAmt
            ? releasedAmountAmt - totalWithdrawnAmt
            : 0;
    }
}
