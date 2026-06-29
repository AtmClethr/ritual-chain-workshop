import type { Address } from "viem";
import { timestampToMs } from "@/lib/format";

/** Parsed shape of the `getBounty` tuple return value. */
export type Bounty = {
  owner: Address;
  title: string;
  rubric: string;
  reward: bigint;
  commitDeadline: bigint;
  revealDeadline: bigint;
  judged: boolean;
  finalized: boolean;
  entryCount: bigint;
  revealedCount: bigint;
  winnerIndex: bigint;
  aiReview: `0x${string}`;
};

/** getBounty returns a positional tuple — map it to a named object. */
export function parseBounty(
  raw: readonly [
    Address,
    string,
    string,
    bigint,
    bigint,
    bigint,
    boolean,
    boolean,
    bigint,
    bigint,
    bigint,
    `0x${string}`,
  ],
): Bounty {
  const [
    owner,
    title,
    rubric,
    reward,
    commitDeadline,
    revealDeadline,
    judged,
    finalized,
    entryCount,
    revealedCount,
    winnerIndex,
    aiReview,
  ] = raw;
  return {
    owner,
    title,
    rubric,
    reward,
    commitDeadline,
    revealDeadline,
    judged,
    finalized,
    entryCount,
    revealedCount,
    winnerIndex,
    aiReview,
  };
}

export type BountyStatus = "commit" | "reveal" | "ready" | "judged" | "finalized";

export function getBountyStatus(b: Bounty, nowMs = Date.now()): BountyStatus {
  if (b.finalized) return "finalized";
  if (b.judged) return "judged";
  if (timestampToMs(b.commitDeadline) > nowMs) return "commit";
  if (timestampToMs(b.revealDeadline) > nowMs) return "reveal";
  return "ready";
}

export const STATUS_META: Record<
  BountyStatus,
  { label: string; tone: "green" | "amber" | "indigo" | "zinc" }
> = {
  commit: { label: "Commit phase", tone: "green" },
  reveal: { label: "Reveal phase", tone: "amber" },
  ready: { label: "Ready for judging", tone: "amber" },
  judged: { label: "Judged", tone: "indigo" },
  finalized: { label: "Finalized", tone: "zinc" },
};

export function canCommit(b: Bounty, nowMs = Date.now()): boolean {
  return !b.judged && !b.finalized && timestampToMs(b.commitDeadline) > nowMs;
}

export function canReveal(b: Bounty, nowMs = Date.now()): boolean {
  return (
    !b.judged &&
    !b.finalized &&
    timestampToMs(b.commitDeadline) <= nowMs &&
    timestampToMs(b.revealDeadline) > nowMs
  );
}

export function canJudge(b: Bounty, nowMs = Date.now()): boolean {
  return (
    !b.judged &&
    !b.finalized &&
    timestampToMs(b.revealDeadline) <= nowMs &&
    b.revealedCount > 0n
  );
}