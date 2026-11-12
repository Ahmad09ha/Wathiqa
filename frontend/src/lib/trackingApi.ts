import {importApi} from "@/lib/importApi";

export interface OceanEvent {
  containerNumber:string; description:string; eventCode:string;
  location:string; date:string; actual:boolean; vessel:string; voyage:string;
}
export interface OceanSnapshot {
  status:string; carrierName:string; carrierCode:string; vessel:string;
  voyage:string; etd:string|null; eta:string|null; actualArrival:string|null;
  latitude:number|null; longitude:number|null;
  positionUpdatedAt:string|null; providerUpdatedAt:string|null; events:OceanEvent[];
}
export interface TrackingReference {
  id:string;shipmentId:string;referenceType:"CT"|"BL";referenceNumber:string;
  carrierCode:string;providerStatus:string;lastSyncedAtUtc:string|null;
  lastAttemptAtUtc:string|null;lastErrorCode:string;snapshot:OceanSnapshot|null;
}
export const listTracking=(shipmentId:string)=>
  importApi<{configured:boolean;records:TrackingReference[]}>(
    "/api/shipments/"+encodeURIComponent(shipmentId)+"/tracking");
export const registerTracking=(shipmentId:string,body:{
  referenceType:"CT"|"BL";referenceNumber:string;carrierCode:string;
})=>importApi<TrackingReference>(
    "/api/shipments/"+encodeURIComponent(shipmentId)+"/tracking",{
      method:"POST",body:JSON.stringify(body)
    });
export const refreshTracking=(id:string)=>
  importApi<TrackingReference>("/api/tracking/"+encodeURIComponent(id)+"/refresh",{
    method:"POST"
  });
