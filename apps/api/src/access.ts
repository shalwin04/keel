import { eq } from "drizzle-orm";
import type { Role } from "@keel/core";
import { schema, type Db } from "@keel/db";
import type { AccountAccess } from "./env.ts";

/** Every ad account the user can see, with their role in its workspace. */
export async function accountsFor(db: Db, userId: string): Promise<AccountAccess[]> {
  const rows = await db
    .select({
      metaAccountId: schema.adAccounts.metaAccountId,
      name: schema.adAccounts.name,
      role: schema.memberships.role,
      workspaceId: schema.brands.workspaceId,
      brandId: schema.brands.id,
      isDemo: schema.workspaces.isDemo,
    })
    .from(schema.memberships)
    .innerJoin(schema.brands, eq(schema.brands.workspaceId, schema.memberships.workspaceId))
    .innerJoin(schema.adAccounts, eq(schema.adAccounts.brandId, schema.brands.id))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.brands.workspaceId))
    .where(eq(schema.memberships.userId, userId));
  return rows.map((r) => ({ ...r, role: r.role as Role }));
}

export async function accessTo(db: Db, userId: string, metaAccountId: string) {
  return (await accountsFor(db, userId)).find((a) => a.metaAccountId === metaAccountId);
}
