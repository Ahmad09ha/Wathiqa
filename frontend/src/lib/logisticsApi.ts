import {importApi} from "@/lib/importApi";

export type BlType = "Original"|"TelexRelease"|"SeaWaybill";
export type BlOriginalStatus = "NotReceived"|"Received"|"HandedToBroker";
export type ContainerStatus = "Planned"|"AtSea"|"AtPort"|"Delivered";
export type ClearanceStatus = "NotStarted"|"MissingDocs"|"UnderInspection"|"FeesPaid"|"Released";

export interface ShipmentInput {
 blNumber:string;blType:BlType;blOriginalStatus:BlOriginalStatus;
  shippingLineId:string|null;vessel:string;voyage:string;
  shipper:string;consignee:string;notifyParty:string;
  shippedOnBoardDate:string|null;originalReceivedDate:string|null;
  packageCount:number|null;palletCount:number|null;
  metadataEdited?:boolean;
 portOfLoading:string;portOfDischarge:string;
 etd:string|null;eta:string|null;freeTimeDays:number;trackingUrl:string;
 revision:number|null;
}
export interface ContainerInput {
 number:string;size:"20"|"40"|"40HC";sealNumber:string;
 grossWeightKg:number|null;netWeightKg:number|null;status:ContainerStatus;
 acknowledgeInvalidDigit:boolean;
 arrivedAtPortDate:string|null;deliveredDate:string|null;freeTimeEndDate:string|null;
 revision:number|null;
}
export interface CustomsInput {
  brokerId:string|null;declarationNumber:string;submittedDate:string|null;
  releasedDate:string|null;status:ClearanceStatus;notes:string;revision:number|null;
  chargesCurrency:string;customsValue:number|null;dutyRatePercent:number|null;
  customsDutyAmount:number|null;taxAmount:number|null;additionalFees:number|null;
  brokerFees:number|null;inlandTransportFees:number|null;demurrageFees:number|null;
  detentionFees:number|null;deliveredToWarehouseDate:string|null;
  chargesEdited?:boolean;
}
export interface LogisticsContainer extends Omit<ContainerInput,"acknowledgeInvalidDigit"> {
 id:string;shipmentId:string;checkDigitValid:boolean;
 invalidDigitAcknowledged:boolean;revision:number;
}
export interface CustomsClearance extends CustomsInput {
 id:string;shipmentId:string;brokerSnapshot:string|null;revision:number;
}
export interface Shipment extends ShipmentInput {
 id:string;orderId:string;shippingLineSnapshot:string|null;revision:number;
 containers:LogisticsContainer[];clearance:CustomsClearance|null;
}
export const listShipments = (orderId:string) =>
 importApi<Shipment[]>("/api/orders/"+encodeURIComponent(orderId)+"/shipments");
export const createShipment = (orderId:string,input:ShipmentInput) =>
 importApi<Shipment>("/api/orders/"+encodeURIComponent(orderId)+"/shipments",{
  method:"POST",body:JSON.stringify(input)
 });
export const fetchShipment = (id:string) =>
 importApi<Shipment>("/api/shipments/"+encodeURIComponent(id));
export const updateShipment = (id:string,input:ShipmentInput) =>
 importApi<Shipment>("/api/shipments/"+encodeURIComponent(id),{
  method:"PUT",body:JSON.stringify(input)
 });
export const createContainer = (shipmentId:string,input:ContainerInput) =>
 importApi<LogisticsContainer>("/api/shipments/"+encodeURIComponent(shipmentId)+"/containers",{
  method:"POST",body:JSON.stringify(input)
 });
export const updateContainer = (containerId:string,input:ContainerInput) =>
 importApi<LogisticsContainer>("/api/containers/"+encodeURIComponent(containerId),{
  method:"PUT",body:JSON.stringify(input)
 });
export const deleteContainer = (containerId:string,revision:number) =>
 importApi<void>("/api/containers/"+encodeURIComponent(containerId)+"?revision="+revision,{
  method:"DELETE"
 });
export const saveClearance = (shipmentId:string,input:CustomsInput) =>
 importApi<CustomsClearance>("/api/shipments/"+encodeURIComponent(shipmentId)+"/clearance",{
  method:"PUT",body:JSON.stringify(input)
 });

// BIC ISO 6346 check-digit feedback for the UI only.
// The .NET backend independently validates this; UI cannot override it.
export function containerNumberFeedback(raw:string) {
 const number=raw.replace(/[\s-]/g,"").toUpperCase();
 if(!/^[A-Z]{3}U\d{7}$/.test(number)){
  return {number,valid:false,formatValid:false};
 }
 let sum=0;
 for(let i=0;i<10;i++){
  const code=number.charCodeAt(i);
  let n=code>=48 && code<=57?code-48:10+code-65;
  if(code>=65 && code<=90)n+=Math.floor((n-1)/10);
  sum+=n*Math.pow(2,i);
 }
 return {number,valid:(sum%11)%10 === Number(number[10]),formatValid:true};
}
