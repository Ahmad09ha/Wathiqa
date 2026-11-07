import {importApi} from "@/lib/importApi";

export interface ContainerReportRow {
  id:string;number:string;size:string;status:string;
  freeTimeEndDate:string|null;arrivedAtPortDate:string|null;
  deliveredDate:string|null;shipmentId:string;blNumber:string;
  eta:string|null;orderId:string;orderNumber:string;supplier:string;
}
export interface ContainerReportPage {
  page:number;pageSize:number;total:number;
  asOfUtcDate:string;items:ContainerReportRow[];
}
export interface MissingDocumentRow {
  orderId:string;orderNumber:string;targetId:string;
  targetType:"Order"|"Shipment"|"Container";
  targetLabel:string;stage:string;documentType:string;requirementId:string;
}
export interface MissingDocumentsPage {
  page:number;pageSize:number;total:number;
  definition:string;items:MissingDocumentRow[];
}
export const fetchOperationalContainers=(params:URLSearchParams)=>
  importApi<ContainerReportPage>("/api/operations/containers?"+params.toString());
export const fetchMissingDocuments=(params:URLSearchParams)=>
  importApi<MissingDocumentsPage>("/api/operations/document-gaps?"+params.toString());
