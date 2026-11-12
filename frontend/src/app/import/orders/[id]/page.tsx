import OrderEditor from "@/components/ImportOrderEditor";
export default async function EditOrderPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{mode?:string}>}){
  const {id}=await params;
  const query=await searchParams;
  return <OrderEditor orderId={id} documentWorkspace={query.mode==="file"}/>;
}
