import {importApi} from "@/lib/importApi";
export const documentTypes=[
  ["Proforma","فاتورة مبدئية"],
  ["CommercialInvoice","فاتورة تجارية"],
  ["PackingList","قائمة التعبئة"],
  ["BillOfLading","بوليصة شحن B/L"],
  ["CertificateOfOrigin","شهادة منشأ"],
  ["QualityCertificate","شهادة جودة"],
  ["InsuranceCertificate","شهادة تأمين"],
  ["CustomsDeclaration","بيان جمركي"],
  ["CustomsReceipt","إيصال جمركي"],
  ["PaymentProof","إثبات حوالة مالية"],
  ["Contract","عقد"],
  ["Other","مستند آخر"]
] as const;

export type DocumentType=(typeof documentTypes)[number][0];
export type DocumentTargetMode="Order"|"Shipment"|"Container";
export interface DocumentLink{
  id:string;orderId:string|null;shipmentId:string|null;containerId:string|null;
  linkedAtUtc:string;
}
export interface BusinessDocument {
  id:string;type:DocumentType;originalFileName:string;
  sizeBytes:number;contentType:string;sha256:string;scanStatus:string;notes:string;
  uploadedAtUtc:string;uploadedById:string;links:DocumentLink[];
}
export interface DocumentList{
  page:number;pageSize:number;total:number;items:BusinessDocument[];
}
export interface DocumentTargets{
  orderId?:string;shipmentId?:string;containerIds?:string[];
}
export interface RequirementRule{
 id:string;targetType:DocumentTargetMode;stage:string;documentType:DocumentType;
 isRequired:boolean;updatedAtUtc?:string;
}
export interface ChecklistItem extends RequirementRule{
  status:"not_applicable"|"not_required"|"satisfied"|"missing"|"waived";
  waiver:null|{id:string;reason:string;approvedById:string;approvedAtUtc:string};
}
export interface DocumentChecklist{
 targetId:string;targetType:DocumentTargetMode;currentStage:string;items:ChecklistItem[];
}
export const documentTypeLabel=(type:string)=>
 documentTypes.find(x=>x[0]===type)?.[1]||type;

function query(target:DocumentTargets){
 const q=new URLSearchParams();
 if(target.orderId)q.set("orderId",target.orderId);
 if(target.shipmentId)q.set("shipmentId",target.shipmentId);
 if(target.containerIds?.length===1)q.set("containerId",target.containerIds[0]);
 return q.toString();
}
export const listDocuments=(target:DocumentTargets,page=1,pageSize=40)=>
 importApi<DocumentList>("/api/documents?"+query(target)+
   "&page="+encodeURIComponent(page)+"&pageSize="+encodeURIComponent(pageSize));
export const listRequirements=()=>
 importApi<RequirementRule[]>("/api/document-requirements");
export const getChecklist=(target:DocumentTargets)=>
 importApi<DocumentChecklist>("/api/document-requirements/checklist?"+query(target));
export const putRequirement=(input:{
  targetType:DocumentTargetMode;stage:string;documentType:DocumentType;isRequired:boolean;
})=>importApi<RequirementRule>("/api/document-requirements",{
  method:"PUT",body:JSON.stringify(input)
});
export const approveWaiver=(ruleId:string,target:DocumentTargets,reason:string)=>
 importApi<{id:string}>("/api/document-requirements/"+ruleId+"/waivers",{
  method:"POST",body:JSON.stringify({...target,reason})
 });
export const revokeWaiver=(waiverId:string)=>
 importApi<void>("/api/document-waivers/"+waiverId,{method:"DELETE"});
export const uploadPrivateDocument=(
  file:File,type:DocumentType,targets:DocumentTargets,notes:string
)=>{
 const body=new FormData();
 body.append("file",file);
 body.append("type",type);
 body.append("notes",notes);
 if(targets.orderId)body.append("orderId",targets.orderId);
 if(targets.shipmentId)body.append("shipmentId",targets.shipmentId);
 for(const id of targets.containerIds||[])body.append("containerIds",id);
 return importApi<{document:BusinessDocument;duplicateInTenant:boolean}>(
  "/api/documents",{method:"POST",body}
 );
};
export const addDocumentLinks=(id:string,targets:DocumentTargets)=>
 importApi<BusinessDocument>("/api/documents/"+id+"/links",{
  method:"POST",body:JSON.stringify(targets)
 });
export const unlinkDocument=(linkId:string)=>
 importApi<void>("/api/document-links/"+linkId,{method:"DELETE"});
export const deletePrivateDocument=(id:string)=>
 importApi<void>("/api/documents/"+id,{method:"DELETE"});
export const documentDownloadUrl=(id:string)=>
 "/import-api/api/documents/"+encodeURIComponent(id)+"/content";
export const documentPreviewUrl=(id:string)=>
 "/import-api/api/documents/"+encodeURIComponent(id)+"/preview";
