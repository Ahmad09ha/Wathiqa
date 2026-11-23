using Microsoft.EntityFrameworkCore;

namespace Wathiqa.ImportApi;

public sealed record SaveRequirementRequest(string? TargetType,string? Stage,string? DocumentType,bool IsRequired);
public sealed record ApproveWaiverRequest(Guid? OrderId,Guid? ShipmentId,List<Guid>? ContainerIds,string? Reason);

public static class DocumentRequirementsApi
{
    private static readonly HashSet<string> AllowedTargetTypes=["Order","Shipment","Container"];
    private static readonly HashSet<string> AllowedStages=[
        "Any","NotShipped","Planned","AtSea","AtPort","PartiallyDelivered","Delivered"
    ];
    public static void Map(WebApplication app)
    {
        var group=app.MapGroup("/api/document-requirements").RequireAuthorization("TenantMember");
        group.MapGet("/",async (ImportDb db)=>
            Results.Ok(await db.DocumentRequirementRules.AsNoTracking()
                .OrderBy(x=>x.TargetType).ThenBy(x=>x.Stage)
                .ThenBy(x=>x.DocumentType)
                .Select(x=>new{x.Id,x.TargetType,x.Stage,x.DocumentType,x.IsRequired,x.UpdatedAtUtc})
                .ToListAsync()));

        group.MapPut("/",async (SaveRequirementRequest input,ImportDb db,
            System.Security.Claims.ClaimsPrincipal user)=>
        {
            var target=(input.TargetType??"").Trim();
            var stage=(input.Stage??"").Trim();
            var type=(input.DocumentType??"").Trim();
            if(!AllowedTargetTypes.Contains(target)||!AllowedStages.Contains(stage)||
               !DocumentsApi.ValidDocumentType(type)||
               (target=="Container"&&stage is "NotShipped" or "PartiallyDelivered") ||
               (target=="Shipment"&&stage=="NotShipped"))
                return Fail("invalid_document_requirement");
            var now=DateTime.UtcNow;
            var actor=CurrentTenant.UserId(user);
            var rule=await db.DocumentRequirementRules
                .SingleOrDefaultAsync(x=>x.TargetType==target&&x.Stage==stage&&x.DocumentType==type);
            if(rule is null)
            {
                rule=new DocumentRequirementRule {
                    TenantId=CurrentTenant.Id(user),TargetType=target,
                    Stage=stage,DocumentType=type
                };
                db.DocumentRequirementRules.Add(rule);
            }
            else if(rule.IsRequired!=input.IsRequired)
            {
                // Changing mandatory policy must not silently reactivate old
                // exceptions after the Admin disables and re-enables a rule.
                var activeWaivers=await db.DocumentRequirementWaivers
                    .Where(x=>x.RequirementId==rule.Id&&x.RevokedAtUtc==null)
                    .ToListAsync();
                foreach(var waiver in activeWaivers)
                {
                    waiver.RevokedAtUtc=now;
                    waiver.RevokedById=actor;
                }
            }
            rule.IsRequired=input.IsRequired;
            rule.UpdatedAtUtc=now;
            rule.UpdatedById=actor;
            await db.SaveChangesAsync();
            return Results.Ok(new{rule.Id,rule.TargetType,rule.Stage,rule.DocumentType,rule.IsRequired});
        }).RequireAuthorization("TenantAdmin");

        group.MapGet("/checklist",async (Guid? orderId,Guid? shipmentId,Guid? containerId,
            ImportDb db,IWebHostEnvironment environment)=>
        {
            var id=containerId??shipmentId??orderId;
            if(id is null || (orderId.HasValue?1:0)+(shipmentId.HasValue?1:0)+(containerId.HasValue?1:0)!=1)
                return Fail("exactly_one_document_target_kind");
            var target=orderId.HasValue?"Order":shipmentId.HasValue?"Shipment":"Container";
            string stage;
            if(orderId.HasValue)
            {
                var record=await db.Orders.AsNoTracking().Where(x=>x.Id==id)
                    .Select(x=>new{x.ArrivalStatus}).SingleOrDefaultAsync();
                if(record is null)return Results.NotFound();
                stage=record.ArrivalStatus;
            }
            else if(shipmentId.HasValue)
            {
                var row=await db.Shipments.AsNoTracking()
                    .Include(x=>x.Containers).SingleOrDefaultAsync(x=>x.Id==id);
                if(row is null)return Results.NotFound();
                stage=ShipmentStage(row.Containers.Where(x=>!x.IsDeleted).Select(x=>x.Status).ToList());
            }
            else
            {
                var status=await db.Containers.AsNoTracking()
                    .Where(x=>x.Id==id).Select(x=>x.Status).SingleOrDefaultAsync();
                if(status is null)return Results.NotFound();
                stage=status;
            }

            var rules=await db.DocumentRequirementRules.AsNoTracking()
                .Where(x=>x.TargetType==target).OrderBy(x=>x.DocumentType).ThenBy(x=>x.Stage)
                .ToListAsync();
            var waiverQuery=db.DocumentRequirementWaivers.AsNoTracking()
                .Where(x=>x.RevokedAtUtc==null);
            if(orderId.HasValue)waiverQuery=waiverQuery.Where(x=>x.OrderId==orderId);
            if(shipmentId.HasValue)waiverQuery=waiverQuery.Where(x=>x.ShipmentId==shipmentId);
            if(containerId.HasValue)waiverQuery=waiverQuery.Where(x=>x.ContainerId==containerId);
            var waivers=await waiverQuery.ToListAsync();
            var linkQuery=db.StoredDocumentLinks.AsNoTracking();
            if(orderId.HasValue)linkQuery=linkQuery.Where(x=>x.OrderId==orderId);
            if(shipmentId.HasValue)linkQuery=linkQuery.Where(x=>x.ShipmentId==shipmentId);
            if(containerId.HasValue)linkQuery=linkQuery.Where(x=>x.ContainerId==containerId);
            if(!environment.IsDevelopment())
                linkQuery=linkQuery.Where(x=>x.Document.ScanStatus=="Clean");
            var attached=await linkQuery.Select(x=>x.Document.Type).Distinct().ToListAsync();

            var result=rules.Select(rule=>{
                var active=rule.Stage=="Any"||rule.Stage==stage;
                var waiver=waivers.FirstOrDefault(x=>x.RequirementId==rule.Id);
                var status=!active?"not_applicable":!rule.IsRequired?"not_required":
                    attached.Contains(rule.DocumentType)?"satisfied":
                    waiver is not null?"waived":"missing";
                return new {
                    rule.Id,rule.TargetType,rule.Stage,rule.DocumentType,
                    rule.IsRequired,Status=status,
                    Waiver=waiver is null?null:(object)new{
                        waiver.Id,waiver.Reason,waiver.ApprovedById,waiver.ApprovedAtUtc
                    }
                };
            }).ToList();
            return Results.Ok(new{targetId=id,targetType=target,currentStage=stage,items=result});
        });

        group.MapPost("/{id:guid}/waivers",async (
            Guid id,ApproveWaiverRequest input,ImportDb db,
            System.Security.Claims.ClaimsPrincipal user)=>
        {
            var rule=await db.DocumentRequirementRules.SingleOrDefaultAsync(x=>x.Id==id);
            if(rule is null)return Results.NotFound();
            if(!rule.IsRequired)return Fail("waiver_not_required");
            var reason=(input.Reason??"").Trim();
            if(reason.Length<8||reason.Length>1000)return Fail("waiver_reason_required");
            var (targets,error)=await DocumentTargets.Resolve(db,input.OrderId,input.ShipmentId,input.ContainerIds);
            if(error is not null)return error=="document_target_not_found"?Results.NotFound():Fail(error);
            if(targets.Count!=1)return Fail("waiver_exactly_one_target");
            var target=targets[0];
            var kind=target.OrderId.HasValue?"Order":target.ShipmentId.HasValue?"Shipment":"Container";
            if(rule.TargetType!=kind)return Fail("waiver_target_mismatch");
            var existing=await db.DocumentRequirementWaivers.AnyAsync(x=>
                x.RequirementId==id && x.RevokedAtUtc==null &&
                x.OrderId==target.OrderId&&x.ShipmentId==target.ShipmentId&&x.ContainerId==target.ContainerId);
            if(existing)return Results.Conflict(new{error="waiver_already_exists"});
            var waiver=new DocumentRequirementWaiver{
                TenantId=CurrentTenant.Id(user),RequirementId=id,
                OrderId=target.OrderId,ShipmentId=target.ShipmentId,
                ContainerId=target.ContainerId,Reason=reason,
                ApprovedById=CurrentTenant.UserId(user),ApprovedAtUtc=DateTime.UtcNow
            };
            db.DocumentRequirementWaivers.Add(waiver);
            try{await db.SaveChangesAsync();}
            catch(DbUpdateException){return Results.Conflict(new{error="waiver_already_exists"});}
            return Results.Created($"/api/document-waivers/{waiver.Id}",
                new{waiver.Id,waiver.RequirementId,waiver.Reason,waiver.ApprovedAtUtc});
        }).RequireAuthorization("TenantAdmin");

        app.MapDelete("/api/document-waivers/{id:guid}",async(
            Guid id,ImportDb db,System.Security.Claims.ClaimsPrincipal user)=>
        {
            var waiver=await db.DocumentRequirementWaivers.SingleOrDefaultAsync(x=>x.Id==id&&x.RevokedAtUtc==null);
            if(waiver is null)return Results.NotFound();
            waiver.RevokedAtUtc=DateTime.UtcNow;
            waiver.RevokedById=CurrentTenant.UserId(user);
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequireAuthorization("TenantAdmin");
    }

    private static string ShipmentStage(List<string> statuses)
    {
        if(statuses.Count==0)return "Planned";
        var delivered=statuses.Count(x=>x=="Delivered");
        if(delivered==statuses.Count)return "Delivered";
        if(delivered>0)return "PartiallyDelivered";
        if(statuses.Contains("AtPort"))return "AtPort";
        if(statuses.Contains("AtSea"))return "AtSea";
        return "Planned";
    }
    private static IResult Fail(string code)=>Results.BadRequest(new{error=code});
}
