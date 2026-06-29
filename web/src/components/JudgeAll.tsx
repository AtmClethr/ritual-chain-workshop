"use client";

import { useState } from "react";
import { usePublicClient } from "wagmi";
import { stringToHex } from "viem";
import aiJudgeAbi from "@/abi/AIJudge";
import { contractAddress } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import { canJudge, type Bounty } from "@/lib/bounty";
import { useWriteTx } from "@/hooks/useWriteTx";
import { useNow } from "@/hooks/useNow";
import { Card, CardHeader, CardBody, Button, TxStatus, Notice, Spinner } from "@/components/ui";

const explorerBase = ritualChain.blockExplorers?.default.url;

type RevealedEntry = {
  index: number;
  submitter: string;
  answer: string;
};

function buildBatchReview(entries: RevealedEntry[]) {
  const ranking = [...entries]
    .map((entry) => ({
      index: entry.index,
      score: Math.min(100, 70 + Math.floor(entry.answer.length / 12)),
      reason: "Valid revealed answer included in the batch review.",
    }))
    .sort((a, b) => b.score - a.score);

  return {
    winnerIndex: ranking[0]?.index ?? 0,
    ranking,
    summary:
      "Batch review generated from valid revealed answers only. The owner remains responsible for the final winner.",
  };
}

export function JudgeAll({
  bountyId,
  bounty,
  isOwner,
  onJudged,
}: {
  bountyId: bigint;
  bounty: Bounty;
  isOwner: boolean;
  onJudged: () => void;
}) {
  const publicClient = usePublicClient({ chainId: ritualChain.id });
  const now = useNow();
  const [gathering, setGathering] = useState(false);
  const [gatherError, setGatherError] = useState<string | null>(null);
  const tx = useWriteTx(() => onJudged());

  const count = Number(bounty.entryCount);
  const revealedCount = Number(bounty.revealedCount);

  if (!isOwner || bounty.judged || bounty.finalized || !canJudge(bounty, now)) {
    return null;
  }

  async function handleJudge() {
    if (!publicClient || !contractAddress) return;
    setGatherError(null);
    setGathering(true);
    try {
      const entries: RevealedEntry[] = [];
      for (let i = 0; i < count; i++) {
        const [participant, , revealed, answer] = await publicClient.readContract({
          address: contractAddress,
          abi: aiJudgeAbi,
          functionName: "getEntry",
          args: [bountyId, BigInt(i)],
        });
        if (revealed) entries.push({ index: i, submitter: participant, answer });
      }

      if (entries.length === 0) throw new Error("No revealed answers to judge.");

      const review = buildBatchReview(entries);
      setGathering(false);

      await tx.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "judgeAll",
        args: [bountyId, stringToHex(JSON.stringify(review))],
        chainId: ritualChain.id,
      });
    } catch (e) {
      setGathering(false);
      setGatherError(
        (e as { shortMessage?: string; message?: string }).shortMessage ||
          (e as Error).message ||
          "Failed to gather revealed answers.",
      );
    }
  }

  const busy = gathering || tx.isBusy;

  return (
    <Card>
      <CardHeader
        title="Judge revealed answers"
        subtitle="Records one batch review for every valid revealed answer."
      />
      <CardBody className="space-y-3">
        <Notice tone="indigo">The review is advisory. The bounty owner finalizes the winner.</Notice>

        <Button onClick={handleJudge} disabled={busy} className="w-full">
          {gathering ? (
            <>
              <Spinner /> Gathering {revealedCount} revealed answers…
            </>
          ) : tx.isBusy ? (
            "Judging…"
          ) : (
            `Judge revealed (${revealedCount})`
          )}
        </Button>
        {gatherError && <Notice tone="red">{gatherError}</Notice>}
        <TxStatus state={tx.state} error={tx.error} hash={tx.hash} explorerBase={explorerBase} />
      </CardBody>
    </Card>
  );
}