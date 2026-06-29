import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("AIJudgeModule", (m) => {
  const aiJudge = m.contract("CommitRevealBounty");

  return { aiJudge };
});
