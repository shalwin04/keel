import type { Role } from "@keel/core";

export interface SessionUser { id: string; name: string }
export interface AppEnv { Variables: { user: SessionUser } }
export interface AccountAccess { metaAccountId: string; role: Role; workspaceId: string; brandId: string; name: string; isDemo: boolean }
