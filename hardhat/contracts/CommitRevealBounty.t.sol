// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CommitRevealBounty} from "./CommitRevealBounty.sol";

contract MockLLM {
    fallback(bytes calldata) external returns (bytes memory) {
        bytes memory actualOutput = abi.encode(
            false,
            bytes("AI review: entry 0 best"),
            bytes(""),
            "",
            CommitRevealBounty.ConvoHistory("", "", "")
        );

        return abi.encode(bytes("simmed"), actualOutput);
    }
}

contract CommitRevealBountyTest is Test {
    CommitRevealBounty internal bounty;
    MockLLM internal mock;

    address internal owner = address(0xA11CE);
    address internal user1 = address(0xB0B);
    address internal user2 = address(0xCAFE);

    uint256 internal constant REWARD = 1 ether;
    uint256 internal commitDeadline;
    uint256 internal revealDeadline;
    uint256 internal bountyId;

    bytes32 internal constant SALT1 = keccak256("salt-1");
    bytes32 internal constant SALT2 = keccak256("salt-2");
    string internal constant ANSWER1 = "Answer from user one";
    string internal constant ANSWER2 = "Answer from user two";

    function setUp() public {
        bounty = new CommitRevealBounty();
        mock = new MockLLM();

        vm.deal(owner, 10 ether);

        commitDeadline = block.timestamp + 1 days;
        revealDeadline = block.timestamp + 2 days;

        vm.prank(owner);
        bountyId = bounty.createBounty{value: REWARD}(
            "Best haiku",
            "Judge clarity and creativity",
            commitDeadline,
            revealDeadline
        );
    }

    function _commitment(
        string memory answer,
        bytes32 salt,
        address participant
    ) internal view returns (bytes32) {
        return keccak256(abi.encode(answer, salt, participant, bountyId));
    }

    function _commit(address participant, string memory answer, bytes32 salt) internal {
        vm.prank(participant);
        bounty.submitCommitment(bountyId, _commitment(answer, salt, participant));
    }

    function _enableJudge() internal {
        vm.etch(address(0x0802), address(mock).code);
    }

    function test_FullFlow() public {
        _commit(user1, ANSWER1, SALT1);
        _commit(user2, ANSWER2, SALT2);

        (, , bool revealedBefore, string memory answerBefore) = bounty.getEntry(bountyId, 0);
        assertFalse(revealedBefore);
        assertEq(bytes(answerBefore).length, 0);

        vm.warp(commitDeadline + 1);

        vm.prank(user1);
        bounty.revealAnswer(bountyId, ANSWER1, SALT1);

        vm.prank(user2);
        bounty.revealAnswer(bountyId, ANSWER2, SALT2);

        (, , bool revealedAfter, string memory answerAfter) = bounty.getEntry(bountyId, 0);
        assertTrue(revealedAfter);
        assertEq(answerAfter, ANSWER1);

        vm.warp(revealDeadline + 1);
        vm.prank(owner);
        bounty.judgeAll(bountyId, bytes("AI review: entry 0 best"));

        (, , , , , , bool judged, , , uint256 revealedCount, , bytes memory review) =
            bounty.getBounty(bountyId);

        assertTrue(judged);
        assertEq(revealedCount, 2);
        assertEq(string(review), "AI review: entry 0 best");

        uint256 balanceBefore = user1.balance;

        vm.prank(owner);
        bounty.finalizeWinner(bountyId, 0);

        assertEq(user1.balance, balanceBefore + REWARD);
    }

    function test_Commit_RevertsAfterDeadline() public {
        vm.warp(commitDeadline + 1);

        vm.prank(user1);
        vm.expectRevert(bytes("commit phase closed"));
        bounty.submitCommitment(bountyId, _commitment(ANSWER1, SALT1, user1));
    }

    function test_Commit_AllowsUpdateBeforeDeadline() public {
        _commit(user1, ANSWER1, SALT1);
        _commit(user1, ANSWER2, SALT2);

        assertEq(bounty.entryCount(bountyId), 1);

        vm.warp(commitDeadline + 1);

        vm.prank(user1);
        vm.expectRevert(bytes("commitment mismatch"));
        bounty.revealAnswer(bountyId, ANSWER1, SALT1);

        vm.prank(user1);
        bounty.revealAnswer(bountyId, ANSWER2, SALT2);
    }

    function test_Reveal_RevertsBeforeCommitDeadline() public {
        _commit(user1, ANSWER1, SALT1);

        vm.prank(user1);
        vm.expectRevert(bytes("reveal not open"));
        bounty.revealAnswer(bountyId, ANSWER1, SALT1);
    }

    function test_Reveal_RevertsAfterRevealDeadline() public {
        _commit(user1, ANSWER1, SALT1);
        vm.warp(revealDeadline + 1);

        vm.prank(user1);
        vm.expectRevert(bytes("reveal phase closed"));
        bounty.revealAnswer(bountyId, ANSWER1, SALT1);
    }

    function test_Reveal_RevertsOnWrongSalt() public {
        _commit(user1, ANSWER1, SALT1);
        vm.warp(commitDeadline + 1);

        vm.prank(user1);
        vm.expectRevert(bytes("commitment mismatch"));
        bounty.revealAnswer(bountyId, ANSWER1, SALT2);
    }

    function test_Reveal_RevertsOnWrongAnswer() public {
        _commit(user1, ANSWER1, SALT1);
        vm.warp(commitDeadline + 1);

        vm.prank(user1);
        vm.expectRevert(bytes("commitment mismatch"));
        bounty.revealAnswer(bountyId, ANSWER2, SALT1);
    }

    function test_Reveal_RevertsForWrongSender() public {
        _commit(user2, ANSWER2, SALT2);
        vm.warp(commitDeadline + 1);

        vm.prank(user1);
        vm.expectRevert(bytes("no commitment"));
        bounty.revealAnswer(bountyId, ANSWER2, SALT2);
    }

    function test_Reveal_RevertsWithoutCommitment() public {
        vm.warp(commitDeadline + 1);

        vm.prank(user1);
        vm.expectRevert(bytes("no commitment"));
        bounty.revealAnswer(bountyId, ANSWER1, SALT1);
    }

    function test_Reveal_RevertsOnDoubleReveal() public {
        _commit(user1, ANSWER1, SALT1);
        vm.warp(commitDeadline + 1);

        vm.prank(user1);
        bounty.revealAnswer(bountyId, ANSWER1, SALT1);

        vm.prank(user1);
        vm.expectRevert(bytes("already revealed"));
        bounty.revealAnswer(bountyId, ANSWER1, SALT1);
    }

    function test_Judge_RevertsBeforeRevealDeadline() public {
        _commit(user1, ANSWER1, SALT1);
        vm.warp(commitDeadline + 1);

        vm.prank(user1);
        bounty.revealAnswer(bountyId, ANSWER1, SALT1);

        vm.prank(owner);
        vm.expectRevert(bytes("reveal not finished"));
        bounty.judgeAll(bountyId, bytes("review"));
    }

    function test_Judge_RevertsNotOwner() public {
        _commit(user1, ANSWER1, SALT1);
        vm.warp(commitDeadline + 1);

        vm.prank(user1);
        bounty.revealAnswer(bountyId, ANSWER1, SALT1);

        vm.warp(revealDeadline + 1);
        vm.prank(user1);
        vm.expectRevert(bytes("not bounty owner"));
        bounty.judgeAll(bountyId, bytes("review"));
    }

    function test_Judge_RevertsNoReveals() public {
        _commit(user1, ANSWER1, SALT1);
        vm.warp(revealDeadline + 1);
        vm.prank(owner);
        vm.expectRevert(bytes("no revealed answers"));
        bounty.judgeAll(bountyId, bytes("review"));
    }

    function test_Finalize_RevertsBeforeJudge() public {
        _commit(user1, ANSWER1, SALT1);
        vm.warp(commitDeadline + 1);

        vm.prank(user1);
        bounty.revealAnswer(bountyId, ANSWER1, SALT1);

        vm.prank(owner);
        vm.expectRevert(bytes("not judged yet"));
        bounty.finalizeWinner(bountyId, 0);
    }

    function test_Finalize_RevertsIfWinnerNotRevealed() public {
        _commit(user1, ANSWER1, SALT1);
        _commit(user2, ANSWER2, SALT2);

        vm.warp(commitDeadline + 1);

        vm.prank(user2);
        bounty.revealAnswer(bountyId, ANSWER2, SALT2);

        vm.warp(revealDeadline + 1);
        vm.prank(owner);
        bounty.judgeAll(bountyId, bytes("AI review: entry 0 best"));

        vm.prank(owner);
        vm.expectRevert(bytes("winner not revealed"));
        bounty.finalizeWinner(bountyId, 0);
    }

    function test_RefundIfNoReveals() public {
        _commit(user1, ANSWER1, SALT1);
        vm.warp(revealDeadline + 1);

        uint256 balanceBefore = owner.balance;

        vm.prank(owner);
        bounty.refundIfNoReveals(bountyId);

        assertEq(owner.balance, balanceBefore + REWARD);
    }
}