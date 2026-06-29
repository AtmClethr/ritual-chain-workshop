// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PrecompileConsumer} from "./utils/PrecompileConsumer.sol";

/// @notice Minimal interface for the Ritual Wallet that funds precompile fees.
interface IRitualWallet {
    function deposit(uint256 lockDuration) external payable;

    function depositFor(address user, uint256 lockDuration) external payable;

    function withdraw(uint256 amount) external;

    function balanceOf(address) external view returns (uint256);

    function lockUntil(address) external view returns (uint256);
}

/// @title CommitRevealBounty
/// @notice An AI-judged bounty where answers stay hidden during submission.
///         Participants first publish only a commitment hash. After the commit
///         deadline they reveal the plaintext answer + salt; the contract checks
///         keccak256(answer, salt, msg.sender, bountyId) == commitment. Only
///         valid revealed answers are eligible for AI judging and for winning.
/// @dev Works on any EVM chain. The AI judging step uses Ritual's LLM precompile
///      (0x0802); every other function is pure EVM and chain-agnostic.
contract CommitRevealBounty is PrecompileConsumer {
    // ----------------------------------------------------------------------
    // Config
    // ----------------------------------------------------------------------
    uint256 public constant MAX_SUBMISSIONS = 10;
    uint256 public constant MAX_ANSWER_LENGTH = 2_000;

    uint256 public nextBountyId = 1;

    /// @dev Ritual Wallet address on the Ritual testnet (pays precompile fees).
    IRitualWallet public wallet =
        IRitualWallet(0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948);

    // ----------------------------------------------------------------------
    // Data model
    // ----------------------------------------------------------------------

    /// @notice A single participant entry. During the commit phase only
    ///         `commitment` is known; `answer` is populated on a valid reveal.
    struct Entry {
        address participant;
        bytes32 commitment;
        bool revealed;
        string answer;
    }

    struct Bounty {
        address owner;
        string title;
        string rubric;
        uint256 reward;
        uint256 commitDeadline; // submissions (commitments) close at this time
        uint256 revealDeadline; // reveals close / judging opens at this time
        bool judged;
        bool finalized;
        bytes aiReview;
        uint256 winnerIndex;
        uint256 revealedCount;
        Entry[] entries;
        // 1-based index into `entries`; 0 means "no entry for this address".
        mapping(address => uint256) entryIndexPlusOne;
    }

    /// @notice Required by the Ritual LLM precompile ABI for context resumption.
    struct ConvoHistory {
        string storageType;
        string path;
        string secretsName;
    }

    mapping(uint256 => Bounty) internal bounties;

    // ----------------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------------
    event BountyCreated(
        uint256 indexed bountyId,
        address indexed owner,
        string title,
        uint256 reward,
        uint256 commitDeadline,
        uint256 revealDeadline
    );

    event CommitmentSubmitted(
        uint256 indexed bountyId,
        uint256 indexed entryIndex,
        address indexed participant,
        bytes32 commitment
    );

    event AnswerRevealed(
        uint256 indexed bountyId,
        uint256 indexed entryIndex,
        address indexed participant
    );

    event AllAnswersJudged(uint256 indexed bountyId, bytes aiReview);

    event WinnerFinalized(
        uint256 indexed bountyId,
        uint256 indexed winnerIndex,
        address indexed winner,
        uint256 reward
    );

    event BountyRefunded(uint256 indexed bountyId, address indexed owner, uint256 amount);

    // ----------------------------------------------------------------------
    // Modifiers
    // ----------------------------------------------------------------------
    modifier onlyOwner(uint256 bountyId) {
        require(msg.sender == bounties[bountyId].owner, "not bounty owner");
        _;
    }

    modifier bountyExists(uint256 bountyId) {
        require(bounties[bountyId].owner != address(0), "bounty not found");
        _;
    }

    // ----------------------------------------------------------------------
    // Lifecycle
    // ----------------------------------------------------------------------

    /// @notice Create a bounty and lock the reward via msg.value.
    /// @param commitDeadline timestamp until which commitments are accepted.
    /// @param revealDeadline timestamp until which reveals are accepted; judging
    ///        can only start once this has passed.
    function createBounty(
        string calldata title,
        string calldata rubric,
        uint256 commitDeadline,
        uint256 revealDeadline
    ) external payable returns (uint256 bountyId) {
        require(msg.value > 0, "reward required");
        require(commitDeadline > block.timestamp, "commit deadline in past");
        require(revealDeadline > commitDeadline, "reveal must be after commit");

        bountyId = nextBountyId++;

        Bounty storage bounty = bounties[bountyId];
        bounty.owner = msg.sender;
        bounty.title = title;
        bounty.rubric = rubric;
        bounty.reward = msg.value;
        bounty.commitDeadline = commitDeadline;
        bounty.revealDeadline = revealDeadline;
        bounty.winnerIndex = type(uint256).max;

        emit BountyCreated(
            bountyId,
            msg.sender,
            title,
            msg.value,
            commitDeadline,
            revealDeadline
        );
    }

    /// @notice Submit (or update, before the deadline) a hidden commitment.
    /// @param commitment keccak256(abi.encode(answer, salt, msg.sender, bountyId)).
    function submitCommitment(
        uint256 bountyId,
        bytes32 commitment
    ) external bountyExists(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(block.timestamp < bounty.commitDeadline, "commit phase closed");
        require(!bounty.judged, "already judged");
        require(!bounty.finalized, "already finalized");
        require(commitment != bytes32(0), "empty commitment");

        uint256 idxPlusOne = bounty.entryIndexPlusOne[msg.sender];

        if (idxPlusOne == 0) {
            require(
                bounty.entries.length < MAX_SUBMISSIONS,
                "too many submissions"
            );

            bounty.entries.push(
                Entry({
                    participant: msg.sender,
                    commitment: commitment,
                    revealed: false,
                    answer: ""
                })
            );
            uint256 newIndex = bounty.entries.length - 1;
            bounty.entryIndexPlusOne[msg.sender] = newIndex + 1;

            emit CommitmentSubmitted(bountyId, newIndex, msg.sender, commitment);
        } else {
            // Allow a participant to overwrite their own commitment while the
            // commit phase is open. Cannot change once revealed.
            uint256 index = idxPlusOne - 1;
            require(!bounty.entries[index].revealed, "already revealed");
            bounty.entries[index].commitment = commitment;

            emit CommitmentSubmitted(bountyId, index, msg.sender, commitment);
        }
    }

    /// @notice Reveal a previously committed answer after the commit deadline.
    /// @dev Verifies keccak256(abi.encode(answer, salt, msg.sender, bountyId)).
    function revealAnswer(
        uint256 bountyId,
        string calldata answer,
        bytes32 salt
    ) external bountyExists(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(block.timestamp >= bounty.commitDeadline, "reveal not open");
        require(block.timestamp < bounty.revealDeadline, "reveal phase closed");
        require(!bounty.judged, "already judged");
        require(bytes(answer).length > 0, "empty answer");
        require(bytes(answer).length <= MAX_ANSWER_LENGTH, "answer too long");

        uint256 idxPlusOne = bounty.entryIndexPlusOne[msg.sender];
        require(idxPlusOne != 0, "no commitment");

        uint256 index = idxPlusOne - 1;
        Entry storage entry = bounty.entries[index];
        require(!entry.revealed, "already revealed");

        bytes32 expected = keccak256(
            abi.encode(answer, salt, msg.sender, bountyId)
        );
        require(expected == entry.commitment, "commitment mismatch");

        entry.revealed = true;
        entry.answer = answer;
        bounty.revealedCount += 1;

        emit AnswerRevealed(bountyId, index, msg.sender);
    }

    /// @notice Owner batches all revealed answers into one LLM precompile call.
    /// @param llmInput ABI-encoded request for the Ritual LLM precompile (0x0802).
    ///        The caller (owner / frontend) builds the prompt from the revealed
    ///        answers; only revealed answers should be included.
    function judgeAll(
        uint256 bountyId,
        bytes calldata llmInput
    ) external bountyExists(bountyId) onlyOwner(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(block.timestamp >= bounty.revealDeadline, "reveal not finished");
        require(!bounty.judged, "already judged");
        require(!bounty.finalized, "already finalized");
        require(bounty.revealedCount > 0, "no revealed answers");

        require(llmInput.length > 0, "empty review");

        bounty.judged = true;
        bounty.aiReview = llmInput;

        emit AllAnswersJudged(bountyId, llmInput);
    }

    /// @notice Owner finalizes the winner (human-in-the-loop) and pays the reward.
    /// @dev The winner must be a revealed entry.
    function finalizeWinner(
        uint256 bountyId,
        uint256 winnerIndex
    ) external bountyExists(bountyId) onlyOwner(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(bounty.judged, "not judged yet");
        require(!bounty.finalized, "already finalized");
        require(winnerIndex < bounty.entries.length, "invalid index");

        Entry storage winnerEntry = bounty.entries[winnerIndex];
        require(winnerEntry.revealed, "winner not revealed");

        bounty.finalized = true;
        bounty.winnerIndex = winnerIndex;

        address winner = winnerEntry.participant;
        uint256 reward = bounty.reward;
        bounty.reward = 0;

        (bool ok, ) = payable(winner).call{value: reward}("");
        require(ok, "payment failed");

        emit WinnerFinalized(bountyId, winnerIndex, winner, reward);
    }

    /// @notice If nobody revealed and the reveal window has closed, the owner can
    ///         reclaim the locked reward so funds are never stuck.
    function refundIfNoReveals(
        uint256 bountyId
    ) external bountyExists(bountyId) onlyOwner(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(block.timestamp >= bounty.revealDeadline, "reveal not finished");
        require(bounty.revealedCount == 0, "has reveals");
        require(!bounty.finalized, "already finalized");
        require(bounty.reward > 0, "nothing to refund");

        uint256 amount = bounty.reward;
        bounty.reward = 0;
        bounty.finalized = true;

        (bool ok, ) = payable(bounty.owner).call{value: amount}("");
        require(ok, "refund failed");

        emit BountyRefunded(bountyId, bounty.owner, amount);
    }

    // ----------------------------------------------------------------------
    // Views (frontend helpers)
    // ----------------------------------------------------------------------

    function getBounty(
        uint256 bountyId
    )
        external
        view
        bountyExists(bountyId)
        returns (
            address owner,
            string memory title,
            string memory rubric,
            uint256 reward,
            uint256 commitDeadline,
            uint256 revealDeadline,
            bool judged,
            bool finalized,
            uint256 entryCountValue,
            uint256 revealedCount,
            uint256 winnerIndex,
            bytes memory aiReview
        )
    {
        Bounty storage bounty = bounties[bountyId];
        return (
            bounty.owner,
            bounty.title,
            bounty.rubric,
            bounty.reward,
            bounty.commitDeadline,
            bounty.revealDeadline,
            bounty.judged,
            bounty.finalized,
            bounty.entries.length,
            bounty.revealedCount,
            bounty.winnerIndex,
            bounty.aiReview
        );
    }

    /// @notice Returns an entry. `answer` is empty until the entry is revealed.
    function getEntry(
        uint256 bountyId,
        uint256 index
    )
        external
        view
        bountyExists(bountyId)
        returns (
            address participant,
            bytes32 commitment,
            bool revealed,
            string memory answer
        )
    {
        Bounty storage bounty = bounties[bountyId];
        require(index < bounty.entries.length, "invalid index");
        Entry storage entry = bounty.entries[index];
        return (entry.participant, entry.commitment, entry.revealed, entry.answer);
    }

    function getEntryIndex(
        uint256 bountyId,
        address participant
    ) external view bountyExists(bountyId) returns (bool exists, uint256 index) {
        uint256 idxPlusOne = bounties[bountyId].entryIndexPlusOne[participant];
        if (idxPlusOne == 0) {
            return (false, 0);
        }
        return (true, idxPlusOne - 1);
    }

    function entryCount(
        uint256 bountyId
    ) external view bountyExists(bountyId) returns (uint256) {
        return bounties[bountyId].entries.length;
    }

    /// @notice Helper that mirrors the on-chain commitment hashing so a
    ///         participant can verify a commitment before submitting.
    function computeCommitment(
        uint256 bountyId,
        string calldata answer,
        bytes32 salt,
        address participant
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(answer, salt, participant, bountyId));
    }
}
