import {importApi} from "@/lib/importApi";

export type DashboardPeriod = 0|7|30|90|365;
export type ActivityCategory = "all"|"orders"|"finance"|"logistics"|"documents"|
  "companies"|"tracking"|"security"|"subscription";

export interface DashboardOverview {
  asOfUtc:string;periodDays:number;
  orders: {total:number;draft:number;active:number;closed:number;
    closedWithExceptions:number;cancelled:number;unpaid:number;partiallyPaid:number;
    paid:number;newInPeriod:number;quantityKg:number};
  financial: {currencies:Array<{currency:string;orders:number;ordered:number;
    commercialPaid:number;remaining:number;netTransferred:number;
    recordedExpenses:number;unresolvedTransfers:number}>;
    overdueOrders:number;activeTransfers:number;recordedExpenses:number;returns:number};
  shipping: {total:number;newInPeriod:number;originalNotReceived:number;
    etaOverdue:number;etaNextSevenDays:number;withContainers:number};
  containers: {total:number;planned:number;atSea:number;atPort:number;
    delivered:number;newInPeriod:number;freeTimeOverdue:number;freeTimeCritical:number};
  customs: {total:number;released:number;processing:number;awaiting:number;
    newInPeriod:number};
  documents: {total:number;newInPeriod:number;unscanned:number;totalBytes:number};
  companies: {total:number;suppliers:number;brokers:number;shippingLines:number;
    newInPeriod:number};
  team: {total:number;active:number;inactive:number;pendingInvitations:number};
  tracking: {planName:string|null;limit:number;used:number;remaining:number;
    references:number;synced:number;errors:number;newInPeriod:number};
  trend:Array<{date:string;orders:number;containers:number}>;
}
export interface DashboardActivity {
  id:string;category:ActivityCategory;action:string;title:string;
  actor:string;occurredAtUtc:string;subject:string|null;
  orderId:string|null;url:string|null;
}
export interface DashboardActivityPage {
  page:number;pageSize:number;total:number;hasMore:boolean;
  items:DashboardActivity[];
}
export function loadDashboardOverview(days:DashboardPeriod,signal?:AbortSignal){
  return importApi<DashboardOverview>("/api/dashboard/overview?days="+days,{signal});
}
export function loadDashboardEvents(days:DashboardPeriod,category:ActivityCategory,
  page:number,pageSize=20,signal?:AbortSignal) {
  const query=new URLSearchParams({days:String(days),category,page:String(page),pageSize:String(pageSize)});
  return importApi<DashboardActivityPage>("/api/dashboard/activity?"+query.toString(),{signal});
}
