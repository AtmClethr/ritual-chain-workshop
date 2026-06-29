"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { bytesToHex, encodeAbiParameters, keccak256, type Address } from "viem";
import { useNow } from "@/hooks/useNow";
import aiJudgeAbi from "@/abi/AIJudge";
import { contractAddress } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import { canCommit, canReveal, type Bounty } from "@/lib/bounty";
import { useWriteTx } from "@/hooks/useWriteTx";
import {
  Card,
  CardHeader,
  CardBody,
  Field,
  Input,
  Textarea,
  Button,
  TxStatus,
  Notice,
} from "@/components/ui";

const explorerBase = ritualChain.blockExplorers?.default.url;
const bytes32Regex = /^0x[0-9a-fA-F]{64}$/;

function generateSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function storageKey(bountyId: bigint, address?: Address) {
  return `commit-reveal:${bountyId.toString()}:${address ?? "unknown"}`;
}

function computeCommitment(
  bountyId: bigint,
  answer: string,
  salt: `0x${string}`,
  participant: Address,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "bytes32" },
        { type: "address" },
        { type: "uint256" },
      ],
      [answer, salt, participant, bountyId],
    ),
  );
}

export function SubmitAnswer({
  bountyId,
  bounty,
  onSubmitted,
}: {
  bountyId: bigint;
  bounty: Bounty;
  onSubmitted: () => void;
}) {
  const { address, isConnected } = useAccount();
  const [answer, setAnswer] = useState("");
  const [salt, setSalt] = useState<`0x${string}` | "">("");
  const [commitment, setCommitment] = useState<`0x${string}` | "">("");
  const now = useNow();

  const commitTx = useWriteTx(() => {
    if (address && answer.trim() && salt) {
      window.localStorage.setItem(
        storageKey(bountyId, address),
        JSON.stringify({ answer: answer.trim(), salt }),
      );
    }
    onSubmitted();
  });

  const revealTx = useWriteTx(() => {
    if (address) window.localStorage.removeItem(storageKey(bountyId, address));
    setAnswer("");
    setSalt("");
    setCommitment("");
    onSubmitted();
  });

  const commitOpen = canCommit(bounty, now);
  const revealOpen = canReveal(bounty, now);

  if (!commitOpen && !revealOpen) return null;

  function fillSavedReveal() {
    if (!address) return;
    const saved = window.localStorage.getItem(storageKey(bountyId, address));
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { answer?: string; salt?: `0x${string}` };
      setAnswer(parsed.answer ?? "");
      setSalt(parsed.salt ?? "");
    } catch {
      /* ignore malformed local cache */
    }
  }

  async function handleCommit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim() || !address || !contractAddress) return;

    const nextSalt = salt && bytes32Regex.test(salt) ? salt : generateSalt();
    const nextCommitment = computeCommitment(bountyId, answer.trim(), nextSalt, address);
    setSalt(nextSalt);
    setCommitment(nextCommitment);

    try {
      await commitTx.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "submitCommitment",
        args: [bountyId, nextCommitment],
        chainId: ritualChain.id,
      });
    } catch {
      /* surfaced via tx.state */
    }
  }

  async function handleReveal(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim() || !salt || !bytes32Regex.test(salt) || !contractAddress) return;

    try {
      await revealTx.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "revealAnswer",
        args: [bountyId, answer.trim(), salt],
        chainId: ritualChain.id,
      });
    } catch {
      /* surfaced via tx.state */
    }
  }

  if (commitOpen) {
    return (
      <Card>
        <CardHeader
          title="Commit hidden answer"
          subtitle="Only a hash is published now. Keep your answer and salt for reveal."
        />
        <CardBody>
          <form onSubmit={handleCommit} className="space-y-3">
            <Notice tone="indigo">
              Commitment = keccak256(answer, salt, your wallet, bountyId). Your plaintext is not
              stored on-chain until reveal.
            </Notice>
            <Field label="Your private answer">
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={5}
                placeholder="Write your submission privately…"
              />
            </Field>
            <Field label="Salt" hint="Auto-generated if blank. Save it for the reveal phase.">
              <Input
                value={salt}
                onChange={(e) => setSalt(e.target.value as `0x${string}`)}
                placeholder="0x… optional bytes32 salt"
              />
            </Field>
            {commitment && (
              <Notice tone="zinc">
                Last commitment: <span className="break-all font-mono">{commitment}</span>
              </Notice>
            )}
            <Button
              type="submit"
              disabled={!isConnected || !answer.trim() || commitTx.isBusy}
              className="w-full"
            >
              {commitTx.isBusy ? "Committing…" : "Submit commitment"}
            </Button>
            {!isConnected && <p className="text-xs text-zinc-500">Connect your wallet to commit.</p>}
            <TxStatus
              state={commitTx.state}
              error={commitTx.error}
              hash={commitTx.hash}
              explorerBase={explorerBase}
            />
          </form>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Reveal answer"
        subtitle="Reveal the answer and salt that match your earlier commitment."
      />
      <CardBody>
        <form onSubmit={handleReveal} className="space-y-3">
          <Button type="button" variant="secondary" onClick={fillSavedReveal} disabled={!address}>
            Load saved answer + salt
          </Button>
          <Field label="Your answer">
            <Textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={5}
              placeholder="Paste the exact committed answer…"
            />
          </Field>
          <Field label="Salt" hint="Must be the exact bytes32 salt used for the commitment.">
            <Input
              value={salt}
              onChange={(e) => setSalt(e.target.value as `0x${string}`)}
              placeholder="0x… bytes32 salt"
            />
          </Field>
          {salt && !bytes32Regex.test(salt) ? (
            <p className="text-xs text-amber-300">Salt must be a 32-byte hex value.</p>
          ) : null}
          <Button
            type="submit"
            disabled={
              !isConnected || !answer.trim() || !salt || !bytes32Regex.test(salt) || revealTx.isBusy
            }
            className="w-full"
          >
            {revealTx.isBusy ? "Revealing…" : "Reveal answer"}
          </Button>
          {!isConnected && <p className="text-xs text-zinc-500">Connect your wallet to reveal.</p>}
          <TxStatus
            state={revealTx.state}
            error={revealTx.error}
            hash={revealTx.hash}
            explorerBase={explorerBase}
          />
        </form>
      </CardBody>
    </Card>
  );
}