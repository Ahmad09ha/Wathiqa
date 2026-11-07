using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc;

namespace Wathiqa.ImportApi;

public sealed record LinkDocumentsRequest(Guid? OrderId,Guid? ShipmentId,List<Guid>? ContainerIds);

public sealed record DocumentTarget(Guid? OrderId,Guid? ShipmentId,Guid? ContainerId,Guid OwningOrderId);

public static class DocumentTargets
{
    public static async Task<(List<DocumentTarget> Targets,string? Error)> Resolve(
        ImportDb db,Guid? orderId,Guid? shipmentId,List<Guid>? containerIds)
    {
        var count=(orderId.HasValue?1:0)+(shipmentId.HasValue?1:0)+((containerIds?.Count??0)>0?1:0);
        if(count!=1)return([], "exactly_one_document_target_kind");
        if(orderId==Guid.Empty || shipmentId==Guid.Empty)return([],"invalid_document_target");
        if(orderId is { } order)
            return await db.Orders.AnyAsync(o=>o.Id==order)
                ? ([new DocumentTarget(order,null,null,order)],null)
                : ([],"document_target_not_found");
        if(shipmentId is { } shipment)
        {
            var owner=await db.Shipments.Where(s=>s.Id==shipment)
                .Select(s=>(Guid?)s.OrderId).SingleOrDefaultAsync();
            return owner.HasValue
                ? ([new DocumentTarget(null,shipment,null,owner.Value)],null)
                : ([],"document_target_not_found");
        }
        if(containerIds is not { Count: >0 and <=20 } ||
           containerIds.Distinct().Count()!=containerIds.Count ||
           containerIds.Any(x=>x==Guid.Empty))
            return([],"invalid_document_targets");
        var found=await db.Containers.AsNoTracking()
            .Where(c=>containerIds.Contains(c.Id))
            .Select(c=>new{c.Id,c.Shipment.OrderId}).ToListAsync();
        if(found.Count!=containerIds.Count)return([],"document_target_not_found");
        return(found.Select(c=>new DocumentTarget(null,null,c.Id,c.OrderId)).ToList(),null);
    }

    public static async Task<(List<DocumentTarget> Targets,string? Error)> Resolve(
        ImportDb db,LinkDocumentsRequest request)=>
        await Resolve(db,request.OrderId,request.ShipmentId,request.ContainerIds);

    public static async Task<bool> BillOfLadingOrderMatches(
        ImportDb db,Guid documentId,IEnumerable<DocumentTarget> targets)
    {
        var incoming=targets.ToList();
        var orderIds=incoming.Select(x=>x.OwningOrderId).Distinct().ToArray();
        if(orderIds.Length!=1)return false;
        var shipmentIds=new HashSet<Guid>();
        foreach(var target in incoming)
        {
            if(target.ShipmentId.HasValue)shipmentIds.Add(target.ShipmentId.Value);
            if(target.ContainerId.HasValue)
            {
                var owner=await db.Containers.Where(c=>c.Id==target.ContainerId)
                    .Select(c=>(Guid?)c.ShipmentId).SingleOrDefaultAsync();
                if(!owner.HasValue)return false;
                shipmentIds.Add(owner.Value);
            }
        }
        var links=await db.StoredDocumentLinks.AsNoTracking()
            .Where(l=>l.DocumentId==documentId)
            .Select(l=>new{l.OrderId,l.ShipmentId,l.ContainerId})
            .ToListAsync();
        foreach(var link in links)
        {
            if(link.OrderId.HasValue && link.OrderId!=orderIds[0])return false;
            if(link.ShipmentId.HasValue)
            {
                if(!await db.Shipments.AnyAsync(s=>s.Id==link.ShipmentId&&s.OrderId==orderIds[0]))
                    return false;
                shipmentIds.Add(link.ShipmentId.Value);
            }
            if(link.ContainerId.HasValue)
            {
                var owner=await db.Containers.Where(c=>c.Id==link.ContainerId &&
                    c.Shipment.OrderId==orderIds[0])
                    .Select(c=>(Guid?)c.ShipmentId).SingleOrDefaultAsync();
                if(!owner.HasValue)return false;
                shipmentIds.Add(owner.Value);
            }
        }
        // A BillOfLading file can support an Order and several Containers,
        // but those containers must all belong to the SAME actual B/L.
        return shipmentIds.Count<=1;
    }

    public static StoredDocumentLink CreateLink(DocumentTarget target,Guid documentId,Guid tenantId,Guid actor,DateTime utc)=>
        new(){
            TenantId=tenantId,DocumentId=documentId,OrderId=target.OrderId,
            ShipmentId=target.ShipmentId,ContainerId=target.ContainerId,
            LinkedById=actor,LinkedAtUtc=utc
        };
}
public static class DocumentsApi
{
    private static readonly HashSet<string> Types= new(StringComparer.Ordinal)
    {
        "Proforma","CommercialInvoice","PackingList","BillOfLading",
        "CertificateOfOrigin","QualityCertificate","InsuranceCertificate",
        "CustomsDeclaration","CustomsReceipt","PaymentProof","Contract","Other"
    };
    internal static bool ValidDocumentType(string type)=>Types.Contains(type);

    public static void Map(WebApplication app)
    {
        var documents=app.MapGroup("/api/documents").RequireAuthorization("TenantMember");
        documents.MapPost("/", Upload)
            .WithMetadata(new RequestSizeLimitAttribute(PrivateDocumentStore.MaxRequestBytes));

        documents.MapGet("/",async (Guid? orderId,Guid? shipmentId,Guid? containerId,ImportDb db,int? page,int? pageSize)=>
        {
            var take=pageSize??40;
            var skipPage=page??1;
            if(take is <1 or >100 || skipPage is <1 or >100000)
                return Results.BadRequest(new{error="invalid_pagination"});
            if((orderId.HasValue?1:0)+(shipmentId.HasValue?1:0)+(containerId.HasValue?1:0)!=1)
                return Results.BadRequest(new{error="exactly_one_document_target_kind"});
            if(orderId.HasValue&&!await db.Orders.AnyAsync(x=>x.Id==orderId))return Results.NotFound();
            if(shipmentId.HasValue&&!await db.Shipments.AnyAsync(x=>x.Id==shipmentId))return Results.NotFound();
            if(containerId.HasValue&&!await db.Containers.AnyAsync(x=>x.Id==containerId))return Results.NotFound();
            IQueryable<StoredDocumentLink> query=db.StoredDocumentLinks.AsNoTracking();
            if(orderId.HasValue)
                query=query.Where(l=>l.OrderId==orderId||
                    (l.ShipmentId.HasValue&&l.Shipment!.OrderId==orderId)||
                    (l.ContainerId.HasValue&&l.Container!.Shipment.OrderId==orderId));
            if(shipmentId.HasValue)
                query=query.Where(l=>l.ShipmentId==shipmentId||
                    (l.ContainerId.HasValue&&l.Container!.ShipmentId==shipmentId));
            if(containerId.HasValue)query=query.Where(l=>l.ContainerId==containerId);
            var ids=await query.Select(x=>x.DocumentId).Distinct().ToListAsync();
            var docs=await db.StoredDocuments.AsNoTracking().Where(d=>ids.Contains(d.Id))
                .OrderByDescending(d=>d.UploadedAtUtc)
                .Skip((skipPage-1)*take).Take(take)
                .Select(d=>new{
                    d.Id,d.Type,d.OriginalFileName,d.SizeBytes,d.ContentType,d.Sha256,d.ScanStatus,
                    d.Notes,d.UploadedAtUtc,d.UploadedById,
                    Links=d.Links.Where(l=>!l.IsDeleted).Select(l=>new{
                        l.Id,l.OrderId,l.ShipmentId,l.ContainerId,l.LinkedAtUtc
                    }).ToList()
                }).ToListAsync();
            return Results.Ok(new{page=skipPage,pageSize=take,total=ids.Count,items=docs});
        });

        documents.MapGet("/{id:guid}",async (Guid id,ImportDb db)=>
        {
            var doc=await db.StoredDocuments.AsNoTracking().Include(d=>d.Links)
                .SingleOrDefaultAsync(d=>d.Id==id);
            return doc is null?Results.NotFound():Results.Ok(Info(doc));
        });
        documents.MapGet("/{id:guid}/content",async (Guid id,ImportDb db,HttpContext context,IPrivateDocumentStore store)=>
            await FileResult(id,db,context,store,false));
        documents.MapGet("/{id:guid}/preview",async (Guid id,ImportDb db,HttpContext context,IPrivateDocumentStore store)=>
            await FileResult(id,db,context,store,true));

        documents.MapPost("/{id:guid}/links",async (
            Guid id,LinkDocumentsRequest request,ImportDb db,
            IWebHostEnvironment environment,System.Security.Claims.ClaimsPrincipal user)=>
        {
            var doc=await db.StoredDocuments.SingleOrDefaultAsync(x=>x.Id==id);
            if(doc is null)return Results.NotFound();
            if(!environment.IsDevelopment()&&doc.ScanStatus!="Clean")
                return Results.Conflict(new{error="document_security_scan_required"});
            var (targets,error)=await DocumentTargets.Resolve(db,request);
            if(error is not null)return Error(error);
            if(doc.Type=="BillOfLading" &&
               !await DocumentTargets.BillOfLadingOrderMatches(db,id,targets))
                return Error("bill_of_lading_cross_order");
            var existing=await db.StoredDocumentLinks
                .Where(x=>x.DocumentId==id).ToListAsync();
            var links=new List<StoredDocumentLink>();
            foreach(var target in targets)
            {
                if(existing.Any(x=>x.OrderId==target.OrderId &&
                        x.ShipmentId==target.ShipmentId && x.ContainerId==target.ContainerId))
                    return Results.Conflict(new{error="document_link_exists"});
                links.Add(DocumentTargets.CreateLink(target,id,doc.TenantId,CurrentTenant.UserId(user),DateTime.UtcNow));
            }
            db.StoredDocumentLinks.AddRange(links);
            AddAudit(db,doc,CurrentTenant.UserId(user),"Linked",
                JsonSerializer.Serialize(links.Select(x=>new{x.OrderId,x.ShipmentId,x.ContainerId})));
            try{await db.SaveChangesAsync();}
            catch(DbUpdateException){return Results.Conflict(new{error="document_link_conflict"});}
            return Results.Ok(Info(await db.StoredDocuments.Include(x=>x.Links).SingleAsync(x=>x.Id==id)));
        });

        app.MapDelete("/api/document-links/{id:guid}",async(
            Guid id,ImportDb db,System.Security.Claims.ClaimsPrincipal user)=>
        {
            await using var tx=await db.Database.BeginTransactionAsync();
            var link=await db.StoredDocumentLinks.Include(x=>x.Document).SingleOrDefaultAsync(x=>x.Id==id);
            if(link is null)return Results.NotFound();
            if(link.OrderId.HasValue&&await PaymentWriteRules.LockOrder(db,CurrentTenant.Id(user),link.OrderId.Value) is null)
                return Results.NotFound();
            if(link.OrderId.HasValue && await FinancialProofInUse(db,link.DocumentId,link.OrderId.Value))
                return Results.Conflict(new{error="document_used_as_financial_evidence"});
            link.IsDeleted=true;
            link.UnlinkedAtUtc=DateTime.UtcNow;
            link.UnlinkedById=CurrentTenant.UserId(user);
            AddAudit(db,link.Document,CurrentTenant.UserId(user),"Unlinked",
                JsonSerializer.Serialize(new{link.OrderId,link.ShipmentId,link.ContainerId}));
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Results.NoContent();
        }).RequireAuthorization("TenantMember");

        documents.MapDelete("/{id:guid}",async (
            Guid id,ImportDb db,System.Security.Claims.ClaimsPrincipal user)=>
        {
            await using var tx=await db.Database.BeginTransactionAsync();
            var doc=await db.StoredDocuments.Include(x=>x.Links).SingleOrDefaultAsync(x=>x.Id==id);
            if(doc is null)return Results.NotFound();
            // A money write holds the exact Order row until commit. Use the
            // same lock here, so proof soft-delete cannot race with recording
            // a remittance/expense on that Order. Sorted to avoid deadlocks.
            foreach(var orderId in doc.Links.Where(x=>!x.IsDeleted&&x.OrderId.HasValue)
                .Select(x=>x.OrderId!.Value).Distinct().OrderBy(x=>x))
                if(await PaymentWriteRules.LockOrder(db,CurrentTenant.Id(user),orderId) is null)
                    return Results.NotFound();
            if(await db.PaymentTransfers.AnyAsync(x=>x.ProofDocumentId==id)||
               await db.PaymentReturns.AnyAsync(x=>x.ProofDocumentId==id)||
               await db.OrderExpenses.AnyAsync(x=>x.EvidenceDocumentId==id))
                return Results.Conflict(new{error="document_used_as_financial_evidence"});
            var actor=CurrentTenant.UserId(user);
            doc.IsDeleted=true;
            doc.DeletedAtUtc=DateTime.UtcNow;
            doc.DeletedById=actor;
            foreach(var link in doc.Links.Where(x=>!x.IsDeleted))
            {
                link.IsDeleted=true;link.UnlinkedAtUtc=DateTime.UtcNow;link.UnlinkedById=actor;
            }
            AddAudit(db,doc,actor,"SoftDeleted",JsonSerializer.Serialize(new{doc.Type,doc.Sha256}));
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            // Physical blob is retained for audit/restore until retention policy
            // is approved; authenticated reads no longer return this document.
            return Results.NoContent();
        });

        DocumentRequirementsApi.Map(app);
    }

    private static async Task<IResult> Upload(
        HttpRequest request,ImportDb db,IPrivateDocumentStore store,
        System.Security.Claims.ClaimsPrincipal user,CancellationToken ct)
    {
        if(!request.HasFormContentType)return Error("multipart_required");
        IFormCollection form;
        try{form=await request.ReadFormAsync(ct);}
        catch(InvalidDataException){return Results.StatusCode(413);}
        var uploaded=form.Files.GetFile("file");
        if(uploaded is null || form.Files.Count!=1)return Error("document_file_required");
        var type=form["type"].ToString().Trim();
        if(!Types.Contains(type))return Error("invalid_document_type");
        var notes=form["notes"].ToString().Trim();
        if(notes.Length>1500)return Error("invalid_document_notes");
        var orderId=ParseGuid(form["orderId"].ToString());
        var shipmentId=ParseGuid(form["shipmentId"].ToString());
        List<Guid>? containerIds=null;
        var rawContainers=form["containerIds"];
        if(rawContainers.Count>0)
        {
            containerIds=[];
            foreach(var raw in rawContainers)
            {
                if(!Guid.TryParse(raw,out var guid))
                    return Error("invalid_document_targets");
                containerIds.Add(guid);
            }
        }
        if(!string.IsNullOrEmpty(form["orderId"])&&!orderId.HasValue ||
           !string.IsNullOrEmpty(form["shipmentId"])&&!shipmentId.HasValue)
            return Error("invalid_document_target");
        var (targets,error)=await DocumentTargets.Resolve(db,orderId,shipmentId,containerIds);
        if(error is not null)return Error(error);
        if(type=="BillOfLading" &&
           !await DocumentTargets.BillOfLadingOrderMatches(db,Guid.Empty,targets))
            return Error("bill_of_lading_cross_order");
        if(uploaded.Length<=0||uploaded.Length>PrivateDocumentStore.MaxFileBytes)
            return Error("invalid_document_size");
        var tenant=CurrentTenant.Id(user);
        var actor=CurrentTenant.UserId(user);
        PrivateFileReceipt receipt;
        try{receipt=await store.SaveAsync(uploaded,tenant,ct);}
        catch(InvalidDocumentException ex){return Error(ex.Code);}
        try
        {
            var now=DateTime.UtcNow;
            var name=DocumentFileName.Clean(uploaded.FileName);
            var duplicate=await db.StoredDocuments.AsNoTracking()
                .AnyAsync(x=>x.Sha256==receipt.Sha256,ct);
            var doc=new StoredDocument {
            TenantId=tenant,Type=type,OriginalFileName=name,
            StorageKey=receipt.StorageKey,ContentType=receipt.ContentType,
            SizeBytes=receipt.SizeBytes,Sha256=receipt.Sha256,ScanStatus=receipt.ScanStatus,Notes=notes,
                UploadedAtUtc=now,UploadedById=actor
            };
            db.StoredDocuments.Add(doc);
            foreach(var target in targets)
                db.StoredDocumentLinks.Add(DocumentTargets.CreateLink(target,doc.Id,tenant,actor,now));
            AddAudit(db,doc,actor,"Uploaded",
                JsonSerializer.Serialize(new{doc.Type,doc.Sha256,doc.SizeBytes,
                    Targets=targets.Select(x=>new{x.OrderId,x.ShipmentId,x.ContainerId})}));
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/documents/{doc.Id}",new{document=Info(doc),duplicateInTenant=duplicate});
        }
        catch
        {
            // Database failure after blob creation must not leave an orphan.
            store.DeleteOrphan(receipt.StorageKey,tenant);
            throw;
        }
    }

    private static async Task<IResult> FileResult(
        Guid id,ImportDb db,HttpContext context,IPrivateDocumentStore store,bool preview)
    {
        var doc=await db.StoredDocuments.AsNoTracking().SingleOrDefaultAsync(d=>d.Id==id);
        if(doc is null)return Results.NotFound();
        if(!context.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment() &&
            doc.ScanStatus!="Clean")
            return Results.Problem(statusCode:503,title:"document_security_scan_required");
        // Tenant ownership was already checked by the global query filter.
        var stream=store.TryOpenRead(doc.StorageKey,doc.TenantId);
        if(stream is null)return Results.Problem(statusCode:503,title:"private_blob_missing");
        context.Response.Headers.CacheControl="private, no-store";
        context.Response.Headers["X-Content-Type-Options"]="nosniff";
        context.Response.Headers["Cross-Origin-Resource-Policy"]="same-origin";
        context.Response.Headers["X-Frame-Options"]="SAMEORIGIN";
        // Browsers sandbox their native PDF viewers themselves; an extra
        // CSP 'sandbox' directive blocks native previews in Chromium.
        // Keep all non-PDF active content forbidden and framing same-origin.
        context.Response.Headers["Content-Security-Policy"]="default-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";
        if(preview)
        {
            context.Response.Headers["Content-Disposition"]="inline";
            return Results.File(stream,doc.ContentType,enableRangeProcessing:true);
        }
        return Results.File(stream,"application/octet-stream",fileDownloadName:doc.OriginalFileName,
            enableRangeProcessing:true);
    }

    internal static object Info(StoredDocument x)=>new{
        x.Id,x.Type,x.OriginalFileName,x.SizeBytes,x.ContentType,
        x.Sha256,x.ScanStatus,x.Notes,x.UploadedAtUtc,x.UploadedById,
        Links=x.Links.Where(l=>!l.IsDeleted).Select(l=>new{
            l.Id,l.OrderId,l.ShipmentId,l.ContainerId,l.LinkedAtUtc
        }).ToArray()
    };
    internal static void AddAudit(ImportDb db,StoredDocument doc,Guid actor,string action,string details)
    {
        db.StoredDocumentAudits.Add(new StoredDocumentAudit{
            TenantId=doc.TenantId,DocumentId=doc.Id,ActorId=actor,
            OccurredAtUtc=DateTime.UtcNow,Action=action,DetailsJson=details
        });
    }
    private static Guid? ParseGuid(string raw)=>
        Guid.TryParse(raw,out var result)?result:null;
    private static async Task<bool> FinancialProofInUse(ImportDb db,Guid documentId,Guid orderId) =>
        await db.PaymentTransfers.AnyAsync(x=>x.OrderId==orderId&&x.ProofDocumentId==documentId)||
        await db.PaymentReturns.AnyAsync(x=>x.OrderId==orderId&&x.ProofDocumentId==documentId)||
        await db.OrderExpenses.AnyAsync(x=>x.OrderId==orderId&&x.EvidenceDocumentId==documentId);
    private static IResult Error(string code)=>
        code=="document_target_not_found"?Results.NotFound():
        code=="scanner_unavailable"?Results.Json(new{error=code},
            statusCode:StatusCodes.Status503ServiceUnavailable):
        Results.BadRequest(new{error=code});
}
