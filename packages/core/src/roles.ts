import type { Action, Approval } from "./schemas.ts";

export const ROLES = ["owner", "reviewer", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** Actions a reviewer may approve on their own; anything that stops delivery or ships new creative needs an owner. */
const REVIEWER_APPROVABLE: Action[] = ["LOG", "RELOCK_SETTING", "REVERT_CREATIVE"];

export function canDecide(role: Role, action: Action, decision: Approval["decision"]): boolean {
  if (role === "owner") return true;
  if (role === "viewer") return false;
  if (decision === "reject") return true;
  return decision === "approve" && REVIEWER_APPROVABLE.includes(action);
}
