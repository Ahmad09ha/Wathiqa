import {importApi} from "@/lib/importApi";

export interface PaymentScheduleView {
  id:string;kind:string;amount:number;dueDate:string;notes:string;
  covered:number;remaining:number;isOverdue:boolean;
}
export interface PaymentTransferView {
  id:string;amount:number;beneficiaryCompanyId:string;beneficiarySnapshot:string;
  transferDate:string;method:string;reference:string;proofDocumentId:string;
  state:"Active"|"Voided";replacesTransferId:string|null;voidReason:string|null;
  returned:number;commercialApplied:number;expenseApplied:number;available:number;
}
export interface OrderExpenseView {
  id:string;amount:number;category:string;description:string;payeeCompanyId:string;
  payeeSnapshot:string;evidenceDocumentId:string;applied:number;remaining:number;
}
export interface PaymentReturnView {
  id:string;transferId:string;amount:number;returnDate:string;bankReference:string;
  reason:string;proofDocumentId:string;
}
export interface OrderFinance {
  orderId:string;number:string;currency:string;commercialAmount:number;
  status:string;revision:number;closedWithExceptions:boolean;
  closureReason:string|null;closedAtUtc:string|null;
  grossOutgoing:number;actualReturns:number;grossActiveTransferred:number;
  appliedCommercial:number;recordedOrderExpenses:number;appliedExpenses:number;
  unresolvedDifference:number;commercialRemainingDue:number;
  paymentStatus:"Paid"|"PartiallyPaid"|"Unpaid";isPaymentOverdue:boolean;
  asOfUtcDate:string;schedules:PaymentScheduleView[];
  transfers:PaymentTransferView[];expenses:OrderExpenseView[];returns:PaymentReturnView[];
}
export type FinanceAction = "schedule"|"transfer"|"expense"|"allocation"|
  "correct"|"return"|"close"|"cancel";
export const getOrderFinance=(orderId:string)=>
  importApi<OrderFinance>("/api/orders/"+encodeURIComponent(orderId)+"/finances");
export function financeWrite(orderId:string,action:FinanceAction,payload:object,
  transferId?:string,expenseId?:string){
  const prefix="/api/orders/"+encodeURIComponent(orderId);
  const t=transferId?encodeURIComponent(transferId):"";
  const e=expenseId?encodeURIComponent(expenseId):"";
  const path={
    schedule:"/payment-schedules",transfer:"/payment-transfers",expense:"/expenses",
    allocation:"/expenses/"+e+"/allocations",
    correct:"/payment-transfers/"+t+"/correct",
    return:"/payment-transfers/"+t+"/returns",close:"/close",cancel:"/cancel"
  }[action];
  return importApi<unknown>(prefix+path,{method:"POST",body:JSON.stringify(payload)});
}
