"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ClipboardCopy, KeyRound, Plus, ShieldCheck, UserRound, Users } from "lucide-react";
import ImportShell from "@/components/ImportShell";
import { useToast } from "@/components/ToastProvider";
import { CurrentImportUser, importApi, ImportTeamUser } from "@/lib/importApi";
import {featureGroups} from "@/lib/featurePermissions";

function TeamContent({admin}: {admin:CurrentImportUser}) {
  const {notify} = useToast();
  const [people, setPeople] = useState<ImportTeamUser[]>([]);
  const [email,setEmail] = useState("");
  const [inviteToken,setInviteToken] = useState<string | null>(null);
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [visibilityDraft,setVisibilityDraft]=useState<string[]>([]);
  const selected=people.find(p=>p.id===selectedId);
  const load = useCallback(async () => {
    try {setPeople(await importApi<ImportTeamUser[]>("/api/users"));}
    catch(error){notify({kind:"error",title:"تعذّر تحميل الفريق",description:(error as Error).message});}
    finally{setLoading(false);}
  },[notify]);
  useEffect(()=>{void load();},[load]);

  async function invite(event:FormEvent) {
    event.preventDefault();
    if(busy)return;
    setBusy(true);
    try{
      const data=await importApi<{token:string;expiresAtUtc:string}>("/api/users/invitations",{
        method:"POST",body:JSON.stringify({email:email.trim()})
      });
      setInviteToken(data.token);setEmail("");
      notify({kind:"success",title:"تم إنشاء الدعوة",description:"الرمز يظهر مرة واحدة فقط. شاركه مع الموظف بطريقة آمنة."});
    }catch(error){
      notify({kind:"error",title:"تعذّر إنشاء الدعوة",description:(error as Error).message});
    }finally{setBusy(false);}
  }
  async function copyInvite() {
    if(!inviteToken)return;
    try{await navigator.clipboard.writeText(inviteToken);notify({kind:"success",title:"تم نسخ رمز الدعوة"});}
    catch{notify({kind:"error",title:"تعذّر نسخ الرمز",description:"حدده وانسخه يدوياً."});}
  }
  async function change(user:ImportTeamUser,kind:"payment"|"active"){
    if(busy)return;
    setBusy(true);
    const payment=kind==="payment";
    try{
      await importApi("/api/users/"+user.id+(payment?"/payment-permission":"/active"),{
        method:"PUT",body:JSON.stringify(payment?{canManagePayments:!user.canManagePayments}:{isActive:!user.isActive})
      });
      await load();
      notify({kind:"success",title: payment?"تم تحديث الصلاحية المالية":"تم تحديث حالة الحساب"});
    }catch(error){notify({kind:"error",title:"تعذّر تحديث الحساب",description:(error as Error).message});}
    finally{setBusy(false);}
  }
  function customize(member:ImportTeamUser) {
    if(member.role==="Admin")return;
    setSelectedId(member.id);
    setVisibilityDraft([...member.permissions]);
  }
  function togglePermission(key:string,enabled:boolean){
    setVisibilityDraft(old=>enabled
      ? [...new Set([...old,key])]
      :old.filter(p=>p!==key));
  }
  async function saveVisibility(){
    if(!selected||busy)return;
    setBusy(true);
    try{
      await importApi("/api/users/"+selected.id+"/visibility",{
        method:"PUT",body:JSON.stringify({permissions:visibilityDraft})
      });
      setSelectedId(null);
      await load();
      notify({kind:"success",title:"تم حفظ صلاحيات الموظف",
        description:"تُطبّق فوراً على الجلسة الحالية وعلى جميع طلبات API."});
    }catch(error){
      notify({kind:"error",title:"تعذّر حفظ الصلاحيات",
        description:(error as Error).message});
    }finally{setBusy(false);}
  }
  return <>
    <div className="im-section-header"><div>
      <small>إدارة التاجر</small><h2>الموظفون والصلاحيات</h2>
      <p>خصص ظهور كل صفحة وتبويب داخل طلب الشراء لكل موظف بشكل مستقل.
        تعديل الدفعات يبقى بحاجة للصلاحية المالية الإضافية.</p>
    </div></div>
    <form className="im-add-form" onSubmit={event=>void invite(event)}>
      <div className="im-add-form-header"><strong><Plus size={17}/> دعوة موظف</strong><p>أنشئ دعوة لموظف، ويمكنه تحديد كلمة مروره عند قبولها.</p></div>
      <div className="im-form-row">
        <label>البريد الإلكتروني<input type="email" dir="ltr" autoComplete="off" required maxLength={254}
          placeholder="employee@company.com" value={email} onChange={event=>setEmail(event.target.value)}/></label>
        <button type="submit" className="btn primary" disabled={busy}>إنشاء رمز الدعوة</button>
      </div>
      {inviteToken && <div className="im-invite-result">
        <KeyRound size={18}/>
        <div><strong>رمز الدعوة — صالح لمدة 48 ساعة</strong><p>احتفظ به بشكل آمن. لا يُعرض مجدداً بعد مغادرة الصفحة.</p>
          <code dir="ltr">{inviteToken}</code></div>
        <button type="button" className="btn btn-outline" onClick={()=>void copyInvite()}><ClipboardCopy size={16}/> نسخ</button>
      </div>}
    </form>
    <div className="im-table-shell">
      <div className="im-table-toolbar"><strong>أعضاء الشركة</strong></div>
      {loading?<div className="im-empty">جارٍ تحميل الموظفين...</div>:
       <div className="im-table-scroll" data-lenis-prevent>
         <table className="im-table">
            <thead><tr><th>الموظف</th><th>الدور</th><th>الصلاحيات المالية</th><th>حالة الحساب</th><th>عرض الأقسام</th></tr></thead>
           <tbody>{people.map(person=><tr key={person.id}>
             <td><div className="im-table-company"><span><UserRound size={19}/></span><div><strong dir="auto">{person.displayName}</strong><small dir="ltr">{person.email}</small></div></div></td>
             <td><span className="im-pill">{person.role==="Admin"?"مدير":"موظف"}</span></td>
             <td>{person.role==="Admin"?"متاحة للمدير":
               <label className="im-toggle"><input type="checkbox" checked={person.canManagePayments} disabled={busy||!person.isActive}
                 onChange={()=>void change(person,"payment")} aria-label={"السماح بالتعديل المالي لـ "+person.displayName}/><span>{person.canManagePayments?"مسموح":"قراءة فقط"}</span></label>}</td>
             <td>{person.id===admin.id ? <span className="im-pill">حسابك</span> :
               <label className="im-toggle"><input type="checkbox" checked={person.isActive} disabled={busy}
                 onChange={()=>void change(person,"active")} aria-label={"تفعيل حساب "+person.displayName}/><span>{person.isActive?"نشط":"معطّل"}</span></label>}
             </td>
             <td>{person.role==="Admin"?"جميع الصلاحيات":
               <button type="button" className="btn btn-outline im-permissions-edit"
                 disabled={busy} onClick={()=>customize(person)}>
                 تخصيص الصلاحيات ({person.permissions.length})
               </button>}</td>
           </tr>)}</tbody>
         </table>
       </div>}
    </div>
    {selected&&<section className="im-permission-editor" aria-label={"صلاحيات "+selected.displayName}>
      <div className="im-permission-editor-head">
        <div><strong>صلاحيات {selected.displayName}</strong>
          <p>حدد الصفحات والتبويبات المسموح لهذا الموظف مشاهدتها. الخيارات غير المحددة ممنوعة حتى عبر API.</p>
        </div>
        <button type="button" className="btn btn-outline" disabled={busy}
          onClick={()=>setSelectedId(null)}>إغلاق</button>
      </div>
      {featureGroups.map(group=><div key={group.title} className="im-permission-group">
        <div><strong>{group.title}</strong><small>{group.description}</small></div>
        <div className="im-permission-grid">{group.items.map(item=><label key={item.key}
          className="im-permission-item">
          <input type="checkbox" disabled={busy}
            checked={visibilityDraft.includes(item.key)}
            onChange={e=>togglePermission(item.key,e.target.checked)}/>
          <span>{item.label}</span>
        </label>)}</div>
      </div>)}
      <p className="im-permission-hint">صلاحية الدفعات هنا تعني مشاهدة التبويب.
        إضافة الحوالات أو تعديلها تحتاج أيضاً تفعيل «الصلاحيات المالية» من الجدول.
        وبعض التبويبات تحتاج صفحة «طلبات الشراء» لتكون مفعّلة معها.</p>
      <div className="im-company-form-actions">
        <button type="button" className="btn primary" disabled={busy}
          onClick={()=>void saveVisibility()}>{busy?"جارٍ الحفظ...":"حفظ صلاحيات الموظف"}</button>
        <button type="button" className="btn btn-outline" disabled={busy}
          onClick={()=>setSelectedId(null)}>إلغاء</button>
      </div>
    </section>}
    <div className="im-info-strip"><ShieldCheck size={21}/><div>
      <strong>التحقق من الصلاحيات يتم في السيرفر</strong>
      <p>أي تغيير يُسجّل في سجل التدقيق ويُطبّق مباشرة دون إعادة تسجيل دخول الموظف.
        يستطيع المدير دائماً الوصول لجميع الأقسام.</p>
    </div></div>
  </>;
}
export default function ImportTeamPage() {
  return <ImportShell section="team" title="الموظفون والصلاحيات" description="التحكم بأقسام الواجهة والتبويبات لكل موظف على حدة.">
    {user=>user.role==="Admin"?<TeamContent admin={user}/>:<div className="im-empty"><Users size={30}/><strong>هذه الصفحة مخصصة لمدير الشركة</strong></div>}
  </ImportShell>;
}
