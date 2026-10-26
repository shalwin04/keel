import { createHmac, timingSafeEqual } from "node:crypto";

/** Single-use approval tokens carried in WhatsApp button ids: `<proposalId>.<decision>.<sig>`. */
const secret = () => process.env.PROPOSAL_SIGNING_SECRET ?? "dev-secret";
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url").slice(0, 16);

export const encodeButtonId = (proposalId: string, decision: string) =>
  `${proposalId}.${decision}.${sign(`${proposalId}.${decision}`)}`;

export function decodeButtonId(id: string): { proposalId: string; decision: string } | null {
  const [proposalId, decision, sig] = id.split(".");
  if (!proposalId || !decision || !sig) return null;
  const expected = sign(`${proposalId}.${decision}`);
  const ok = sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return ok ? { proposalId, decision } : null;
}
