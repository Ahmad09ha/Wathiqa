import { importApi, ImportApiError } from "@/lib/importApi";

export interface PlatformIdentity {
  id: string; email: string; displayName: string; role: "SuperAdmin";
}
export interface PlatformOverview {
  totalTenants: number; active: number; suspended: number;
  expired: number; accounts: number;
}
export interface PlatformTenant {
  id: string; name: string; slug: string; isActive: boolean;
  accessExpiresAtUtc: string | null; createdAtUtc: string;
  platformRevision: number; userCount: number;
}
export interface PlatformUser {
  id: string; email: string; displayName: string; isActive: boolean;
  canManagePayments: boolean; createdAtUtc: string; role: "Admin" | "Staff";
}
export interface PlatformUserDirectoryEntry extends PlatformUser {
  tenantId:string;tenantName:string;
}
export interface PlatformAudit {
  id: string; operatorId: string; tenantId: string | null;
  targetUserId: string | null; action: string; reason: string;
  beforeJson: string; afterJson: string; occurredAtUtc: string;
}
export interface PlatformPage<T> {
  page: number; pageSize: number; total: number; items: T[];
}
export interface TenantCreation {
  id: string; name: string; slug: string; platformRevision: number;
  accountReady:boolean;adminUserId:string|null;adminEmail:string;
  invitationToken:string|null;invitationExpiresAtUtc:string|null;
}
export type AccessMode = "Unlimited" | "Expires";

export interface ManualPlan {
  id:string;code:string;name:string;durationMonths:number|null;
  maxTrackedBills:number;isActive:boolean;createdAtUtc:string;tenantCount:number;
}
export interface CurrentManualSubscription {
  id:string;planId:string;planName:string;planCode:string;
  durationMonths:number|null;maxTrackedBills:number;
  startedAtUtc:string;expiresAtUtc:string|null;
  endedAtUtc:string|null;lastChangedAtUtc:string;
}
export interface TenantManualSubscription {
  tenantId:string;tenantName:string;isActive:boolean;accessExpiresAtUtc:string|null;
  platformRevision:number;hasSubscription:boolean;
  subscription:CurrentManualSubscription|null;
}
export interface ManualSubscriptionDirectoryItem {
  tenantId:string;tenantName:string;tenantSlug:string;isActive:boolean;
  platformRevision:number;accessExpiresAtUtc:string|null;
  hasSubscription:boolean;planId:string|null;planName:string|null;
  planCode:string|null;durationMonths:number|null;
  maxTrackedBills:number|null;
  startedAtUtc:string|null;endedAtUtc:string|null;lastChangedAtUtc:string|null;
}
export const getManualPlans = () => platformApi<ManualPlan[]>("/plans");
export const getManualSubscriptions = (q:URLSearchParams) =>
  platformApi<PlatformPage<ManualSubscriptionDirectoryItem>>("/subscriptions?"+q.toString());
export const getTenantManualSubscription = (tenantId:string) =>
  platformApi<TenantManualSubscription>("/tenants/"+encodeURIComponent(tenantId)+"/subscription");

export const platformApi = <T>(path: string, options?: RequestInit) =>
  importApi<T>("/api/platform" + path, options);
export const getPlatformMe = () => platformApi<PlatformIdentity>("/auth/me");
export const getPlatformOverview = () => platformApi<PlatformOverview>("/overview");
export const getPlatformTenants = (query: URLSearchParams) =>
  platformApi<PlatformPage<PlatformTenant>>("/tenants?" + query.toString());
export const getPlatformTenant = (id: string) =>
  platformApi<PlatformTenant>("/tenants/" + encodeURIComponent(id));
export const getPlatformTenantUsers = (id: string, page = 1) =>
  platformApi<PlatformPage<PlatformUser>>("/tenants/" + encodeURIComponent(id) + "/users?page=" + page);
export const getPlatformUsers = (query:URLSearchParams) =>
  platformApi<PlatformPage<PlatformUserDirectoryEntry>>("/users?" + query.toString());
export const getPlatformAudits = (tenantId?: string, page = 1) => {
  const query = new URLSearchParams({page: String(page),pageSize:"25"});
  if (tenantId) query.set("tenantId",tenantId);
  return platformApi<PlatformPage<PlatformAudit>>("/audits?" + query);
};
export { ImportApiError };
