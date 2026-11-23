using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Wathiqa.ImportApi;

public static class LogisticsApi
{
    public static void Map(WebApplication app)
    {
        var orders=app.MapGroup("/api/orders").RequireAuthorization("TenantMember");
        var shipments=app.MapGroup("/api/shipments").RequireAuthorization("TenantMember");
        var containers=app.MapGroup("/api/containers").RequireAuthorization("TenantMember");

        orders.MapGet("/{orderId:guid}/shipments", async (Guid orderId,ImportDb db,HttpContext http) =>
        {
            if(!await db.Orders.AnyAsync(x=>x.Id==orderId))return Results.NotFound();
            var list=await db.Shipments.AsNoTracking().Where(x=>x.OrderId==orderId)
                .Include(x=>x.Containers).Include(x=>x.Clearance)
                .OrderBy(x=>x.CreatedAtUtc).ToListAsync();
            var canReadCustoms = TenantFeaturePermissions.GrantedToRequest(
                http, TenantFeaturePermissions.Customs);
            var canReadBl = TenantFeaturePermissions.GrantedToRequest(
                http, TenantFeaturePermissions.BillOfLading);
            return Results.Ok(list.Select(x=>Detail(x,canReadCustoms,canReadBl)));
        });
        orders.MapPost("/{orderId:guid}/shipments",async (
            Guid orderId,ShipmentInput body,ImportDb db,System.Security.Claims.ClaimsPrincipal principal) =>
        {
            ValidatedShipment input;
            try{input=LogisticsValidation.Check(body);}
            catch(LogisticsValidationException ex){return Bad(ex);}
            var order=await db.Orders.SingleOrDefaultAsync(x=>x.Id==orderId);
            if(order is null)return Results.NotFound();
            var line=await ShippingLine(db,input.ShippingLineId);
            if(input.ShippingLineId.HasValue && line is null)
                return Results.BadRequest(new{error="shipping_line_unavailable"});
            var tenant=CurrentTenant.Id(principal);
            var actor=CurrentTenant.UserId(principal);
            var now=DateTime.UtcNow;
            await using var transaction=await db.Database.BeginTransactionAsync();
            var entity=new ImportShipment {
                TenantId=tenant,OrderId=order.Id,CreatedById=actor,UpdatedById=actor,
                CreatedAtUtc=now,UpdatedAtUtc=now
            };
            Apply(entity,input,line);
            db.Shipments.Add(entity);
            AddAudit(db,tenant,order.Id,entity.Id,"Shipment",entity.Id,
                "Created",actor,now,"",JsonSerializer.Serialize(Detail(entity)));
            try{
                await db.SaveChangesAsync();
                await LogisticsRollup.RefreshAsync(db,order,actor,now);
                await db.SaveChangesAsync();
                await transaction.CommitAsync();
                return Results.Created($"/api/shipments/{entity.Id}",Detail(entity));
            }catch(DbUpdateConcurrencyException){return Conflict("order_changed_retry");}
            catch(DbUpdateException){return Conflict("duplicate_bl_number");}
        });

        shipments.MapGet("/{id:guid}",async (Guid id,ImportDb db,HttpContext http) =>
        {
            var shipment=await db.Shipments.AsNoTracking().Include(s=>s.Containers)
                .Include(s=>s.Clearance).SingleOrDefaultAsync(s=>s.Id==id);
            return shipment is null?Results.NotFound():Results.Ok(Detail(shipment,
                TenantFeaturePermissions.GrantedToRequest(http,TenantFeaturePermissions.Customs)));
        });
        shipments.MapPut("/{id:guid}",async (
            Guid id,ShipmentInput body,ImportDb db,
            System.Security.Claims.ClaimsPrincipal principal,HttpContext http) =>
        {
            if(body.Revision is null or < 1)return Invalid("revision_required");
            ValidatedShipment input;
            try{input=LogisticsValidation.Check(body);}
            catch(LogisticsValidationException ex){return Bad(ex);}
            await using var transaction=await db.Database.BeginTransactionAsync();
            // Lock the B/L row while editing. Tracking activation takes the
            // same row lock before reserving its paid ShipsGo request.
            var shipment=await db.Shipments.FromSqlInterpolated(
                $"SELECT * FROM \"Shipments\" WHERE \"Id\"={id} FOR UPDATE")
                .SingleOrDefaultAsync();
            if(shipment is null)return Results.NotFound();
            if(shipment.Revision!=body.Revision)return Conflict("stale_shipment_revision");
            await db.Entry(shipment).Collection(s=>s.Containers).LoadAsync();
            await db.Entry(shipment).Reference(s=>s.Clearance).LoadAsync();
            var changedBill=!string.Equals(shipment.BlNumber,input.BlNumber,
                StringComparison.OrdinalIgnoreCase);
            if(changedBill && await db.SubscriptionTrackingUsages.AnyAsync(x=>
                x.ShipmentId==id))
                return Conflict("tracking_bl_change_requires_reconciliation");
            if(changedBill)
            {
                // Pending (never activated) B/L references follow the
                // correction rather than retaining an unrelated number.
                var refs=await db.TrackingReferences.Where(x=>
                    x.ShipmentId==id && x.ReferenceType=="BL").ToListAsync();
                foreach(var reference in refs)
                {
                    reference.ReferenceNumber=input.BlNumber.ToUpperInvariant();
                    reference.UpdatedAtUtc=DateTime.UtcNow;
                    reference.UpdatedById=CurrentTenant.UserId(principal);
                }
            }
            var line=await ShippingLine(db,input.ShippingLineId);
            if(input.ShippingLineId.HasValue && line is null)
                return Invalid("shipping_line_unavailable");
            var order=await db.Orders.SingleAsync(x=>x.Id==shipment.OrderId);
            var before=JsonSerializer.Serialize(Detail(shipment));
            var actor=CurrentTenant.UserId(principal);
            var now=DateTime.UtcNow;
            Apply(shipment,input,line,body.MetadataEdited);
            shipment.Revision++;
            shipment.UpdatedAtUtc=now;
            shipment.UpdatedById=actor;
            AddAudit(db,shipment.TenantId,order.Id,shipment.Id,"Shipment",shipment.Id,
                "Updated",actor,now,before,JsonSerializer.Serialize(Detail(shipment)));
            try{
                await db.SaveChangesAsync();
                await LogisticsRollup.RefreshAsync(db,order,actor,now);
                await db.SaveChangesAsync();
                await transaction.CommitAsync();
            return Results.Ok(Detail(shipment,
                TenantFeaturePermissions.GrantedToRequest(http,TenantFeaturePermissions.Customs)));
            }catch(DbUpdateConcurrencyException){return Conflict("stale_shipment_revision");}
            catch(DbUpdateException){return Conflict("shipment_update_conflict");}
        });

        shipments.MapGet("/{id:guid}/containers",async (Guid id,ImportDb db) =>
        {
            if(!await db.Shipments.AnyAsync(s=>s.Id==id))return Results.NotFound();
            return Results.Ok(await db.Containers.AsNoTracking().Where(c=>c.ShipmentId==id)
                .OrderBy(c=>c.CreatedAtUtc).Select(c=>new
                {
                    c.Id,c.ShipmentId,c.Number,c.Size,c.SealNumber,c.GrossWeightKg,
                    c.NetWeightKg,c.Status,c.CheckDigitValid,c.InvalidDigitAcknowledged,
                    c.ArrivedAtPortDate,c.DeliveredDate,c.FreeTimeEndDate,c.Revision
                }).ToListAsync());
        });
        shipments.MapPost("/{id:guid}/containers",async (
            Guid id,ContainerInput body,ImportDb db,System.Security.Claims.ClaimsPrincipal principal) =>
        {
            ValidatedContainer input;
            try{input=LogisticsValidation.Check(body);}
            catch(LogisticsValidationException ex){return Bad(ex);}
            await using var transaction=await db.Database.BeginTransactionAsync();
            var shipment=await db.Shipments.SingleOrDefaultAsync(s=>s.Id==id);
            if(shipment is null)return Results.NotFound();
            var order=await db.Orders.SingleAsync(o=>o.Id==shipment.OrderId);
            var actor=CurrentTenant.UserId(principal);
            var now=DateTime.UtcNow;
            var entity=new ImportContainer {
                TenantId=shipment.TenantId,ShipmentId=id,
                CreatedById=actor,UpdatedById=actor,CreatedAtUtc=now,UpdatedAtUtc=now
            };
            Apply(entity,input);
            db.Containers.Add(entity);
            AddAudit(db,entity.TenantId,order.Id,id,"Container",entity.Id,
                "Created",actor,now,"",JsonSerializer.Serialize(ContainerDetail(entity)));
            try{
                await db.SaveChangesAsync();
                await LogisticsRollup.RefreshAsync(db,order,actor,now);
                await db.SaveChangesAsync();
                await transaction.CommitAsync();
                return Results.Created($"/api/containers/{entity.Id}",ContainerDetail(entity));
            }catch(DbUpdateConcurrencyException){return Conflict("order_changed_retry");}
            catch(DbUpdateException){return Conflict("duplicate_container_number");}
        });
        containers.MapPut("/{id:guid}",async (
            Guid id,ContainerInput body,ImportDb db,System.Security.Claims.ClaimsPrincipal principal) =>
        {
            if(body.Revision is null or < 1)return Invalid("revision_required");
            await using var transaction=await db.Database.BeginTransactionAsync();
            var entity=await db.Containers.SingleOrDefaultAsync(c=>c.Id==id);
            if(entity is null)return Results.NotFound();
            if(entity.Revision!=body.Revision)return Conflict("stale_container_revision");
            ValidatedContainer input;
            try{input=LogisticsValidation.Check(body,entity.Status);}
            catch(LogisticsValidationException ex){return Bad(ex);}
            var shipment=await db.Shipments.SingleAsync(s=>s.Id==entity.ShipmentId);
            var order=await db.Orders.SingleAsync(o=>o.Id==shipment.OrderId);
            var actor=CurrentTenant.UserId(principal);
            var now=DateTime.UtcNow;
            var before=JsonSerializer.Serialize(ContainerDetail(entity));
            Apply(entity,input);
            entity.Revision++;
            entity.UpdatedAtUtc=now;
            entity.UpdatedById=actor;
            AddAudit(db,entity.TenantId,order.Id,entity.ShipmentId,"Container",entity.Id,
                "Updated",actor,now,before,JsonSerializer.Serialize(ContainerDetail(entity)));
            try{
                await db.SaveChangesAsync();
                await LogisticsRollup.RefreshAsync(db,order,actor,now);
                await db.SaveChangesAsync();
                await transaction.CommitAsync();
                return Results.Ok(ContainerDetail(entity));
            }catch(DbUpdateConcurrencyException){return Conflict("stale_container_revision");}
            catch(DbUpdateException){return Conflict("container_update_conflict");}
        });
        containers.MapDelete("/{id:guid}",async (
            Guid id,int? revision,ImportDb db,System.Security.Claims.ClaimsPrincipal principal) =>
        {
            if(revision is null or < 1)return Invalid("revision_required");
            await using var transaction=await db.Database.BeginTransactionAsync();
            var container=await db.Containers.SingleOrDefaultAsync(c=>c.Id==id);
            if(container is null)return Results.NotFound();
            if(container.Revision!=revision)return Conflict("stale_container_revision");
            // Deleting an already shipped container would erase material logistics
            // evidence; a future audited correction path must handle that case.
            if(container.Status!="Planned")return Conflict("only_planned_container_deletable");
            var shipment=await db.Shipments.SingleAsync(s=>s.Id==container.ShipmentId);
            var order=await db.Orders.SingleAsync(o=>o.Id==shipment.OrderId);
            var actor=CurrentTenant.UserId(principal);
            var now=DateTime.UtcNow;
            var before=JsonSerializer.Serialize(ContainerDetail(container));
            container.IsDeleted=true;
            container.Revision++;
            container.UpdatedAtUtc=now;
            container.UpdatedById=actor;
            AddAudit(db,container.TenantId,order.Id,container.ShipmentId,"Container",container.Id,
                "DraftDeleted",actor,now,before,JsonSerializer.Serialize(ContainerDetail(container)));
            try{
                await db.SaveChangesAsync();
                await LogisticsRollup.RefreshAsync(db,order,actor,now);
                await db.SaveChangesAsync();
                await transaction.CommitAsync();
                return Results.NoContent();
            }catch(DbUpdateConcurrencyException){return Conflict("stale_container_revision");}
        });

        shipments.MapGet("/{id:guid}/clearance",async (Guid id,ImportDb db) =>
        {
            if(!await db.Shipments.AnyAsync(s=>s.Id==id))return Results.NotFound();
            var clearance=await db.CustomsClearances.AsNoTracking()
                .SingleOrDefaultAsync(c=>c.ShipmentId==id);
            return Results.Ok(clearance is null?null:ClearanceDetail(clearance));
        });
        shipments.MapPut("/{id:guid}/clearance",async (
            Guid id,ClearanceInput body,ImportDb db,System.Security.Claims.ClaimsPrincipal principal) =>
        {
            ValidatedClearance input;
            try{input=LogisticsValidation.Check(body);}
            catch(LogisticsValidationException ex){return Bad(ex);}
            await using var transaction=await db.Database.BeginTransactionAsync();
            var shipment=await db.Shipments.SingleOrDefaultAsync(s=>s.Id==id);
            if(shipment is null)return Results.NotFound();
            var broker=await Broker(db,input.BrokerId);
            if(input.BrokerId.HasValue && broker is null)return Invalid("broker_unavailable");
            var order=await db.Orders.SingleAsync(o=>o.Id==shipment.OrderId);
            var clearance=await db.CustomsClearances.SingleOrDefaultAsync(c=>c.ShipmentId==id);
            var isNew=clearance is null;
            if(isNew && body.Revision is not null) return Conflict("stale_clearance_revision");
            if(!isNew && (body.Revision is null || clearance!.Revision!=body.Revision))
                return Conflict("stale_clearance_revision");
            var actor=CurrentTenant.UserId(principal);
            var now=DateTime.UtcNow;
            var before=isNew?"":JsonSerializer.Serialize(ClearanceDetail(clearance!));
            clearance ??=new ImportCustomsClearance {
                TenantId=shipment.TenantId,ShipmentId=id,
                CreatedById=actor,CreatedAtUtc=now
            };
            Apply(clearance,input,broker,isNew||body.ChargesEdited);
            clearance.UpdatedAtUtc=now;
            clearance.UpdatedById=actor;
            if(!isNew)clearance.Revision++;
            else db.CustomsClearances.Add(clearance);
            AddAudit(db,clearance.TenantId,order.Id,id,"Customs",clearance.Id,
                isNew?"Created":"Updated",actor,now,before,JsonSerializer.Serialize(ClearanceDetail(clearance)));
            try{
                await db.SaveChangesAsync();
                await LogisticsRollup.RefreshAsync(db,order,actor,now);
                await db.SaveChangesAsync();
                await transaction.CommitAsync();
                return Results.Ok(ClearanceDetail(clearance));
            }catch(DbUpdateConcurrencyException){return Conflict("stale_clearance_revision");}
            catch(DbUpdateException){return Conflict("clearance_update_conflict");}
        });
    }

    private static void Apply(ImportShipment entity,ValidatedShipment input,string? line,bool metadataEdited = true)
    {
        entity.BlNumber=input.BlNumber;entity.BlType=input.BlType;
        entity.BlOriginalStatus=input.BlOriginalStatus;
        entity.ShippingLineId=input.ShippingLineId;entity.ShippingLineSnapshot=line;
        entity.Vessel=input.Vessel;entity.Voyage=input.Voyage;
        if(metadataEdited)
        {
            entity.Shipper=input.Shipper;entity.Consignee=input.Consignee;
            entity.NotifyParty=input.NotifyParty;
            entity.ShippedOnBoardDate=input.ShippedOnBoardDate;
            entity.OriginalReceivedDate=input.OriginalReceivedDate;
            entity.PackageCount=input.PackageCount;entity.PalletCount=input.PalletCount;
        }
        entity.PortOfLoading=input.PortOfLoading;entity.PortOfDischarge=input.PortOfDischarge;
        entity.Etd=input.Etd;entity.Eta=input.Eta;
        entity.FreeTimeDays=input.FreeTimeDays;entity.TrackingUrl=input.TrackingUrl;
    }
    private static void Apply(ImportContainer entity,ValidatedContainer input)
    {
        entity.Number=input.Number;entity.Size=input.Size;entity.SealNumber=input.SealNumber;
        entity.GrossWeightKg=input.GrossWeightKg;entity.NetWeightKg=input.NetWeightKg;
        entity.Status=input.Status;entity.CheckDigitValid=input.CheckDigitValid;
        entity.InvalidDigitAcknowledged=input.InvalidDigitAcknowledged;
        entity.ArrivedAtPortDate=input.ArrivedAtPortDate;entity.DeliveredDate=input.DeliveredDate;
        entity.FreeTimeEndDate=input.FreeTimeEndDate;
    }
    private static void Apply(ImportCustomsClearance entity,ValidatedClearance input,string? broker,bool chargesEdited)
    {
        entity.BrokerId=input.BrokerId;entity.BrokerSnapshot=broker;
        entity.DeclarationNumber=input.DeclarationNumber;entity.SubmittedDate=input.SubmittedDate;
        entity.ReleasedDate=input.ReleasedDate;entity.Status=input.Status;entity.Notes=input.Notes;
        if(!chargesEdited)return;
        entity.ChargesCurrency=input.ChargesCurrency;
        entity.CustomsValue=input.CustomsValue;
        entity.DutyRatePercent=input.DutyRatePercent;
        entity.CustomsDutyAmount=input.CustomsDutyAmount;
        entity.TaxAmount=input.TaxAmount;
        entity.AdditionalFees=input.AdditionalFees;
        entity.BrokerFees=input.BrokerFees;
        entity.InlandTransportFees=input.InlandTransportFees;
        entity.DemurrageFees=input.DemurrageFees;
        entity.DetentionFees=input.DetentionFees;
        entity.DeliveredToWarehouseDate=input.DeliveredToWarehouseDate;
    }
    private static async Task<string?> ShippingLine(ImportDb db,Guid? id)=>
        id is null?null:await db.Companies.AsNoTracking()
            .Where(x=>x.Id==id && x.Type=="ShippingLine").Select(x=>x.Name).FirstOrDefaultAsync();
    private static async Task<string?> Broker(ImportDb db,Guid? id)=>
        id is null?null:await db.Companies.AsNoTracking()
            .Where(x=>x.Id==id && x.Type=="Broker").Select(x=>x.Name).FirstOrDefaultAsync();

    private static object Detail(ImportShipment x,
        bool includeCustoms=true,bool includeBl=true)=>new
    {
        x.Id,x.OrderId,x.BlNumber,
        BlType=includeBl?x.BlType:"",BlOriginalStatus=includeBl?x.BlOriginalStatus:"",
        ShippingLineId=includeBl?x.ShippingLineId:null,
        ShippingLineSnapshot=includeBl?x.ShippingLineSnapshot:"",
        Vessel=includeBl?x.Vessel:"",Voyage=includeBl?x.Voyage:"",
        Shipper=includeBl?x.Shipper:"",Consignee=includeBl?x.Consignee:"",
        NotifyParty=includeBl?x.NotifyParty:"",
        ShippedOnBoardDate=includeBl?x.ShippedOnBoardDate:null,
        OriginalReceivedDate=includeBl?x.OriginalReceivedDate:null,
        PackageCount=includeBl?x.PackageCount:null,
        PalletCount=includeBl?x.PalletCount:null,
        PortOfLoading=includeBl?x.PortOfLoading:"",
        PortOfDischarge=includeBl?x.PortOfDischarge:"",
        Etd=includeBl?x.Etd:null,Eta=includeBl?x.Eta:null,
        x.FreeTimeDays,
        TrackingUrl=includeBl?x.TrackingUrl:"",x.Revision,
        Containers=x.Containers.Where(c=>!c.IsDeleted).OrderBy(c=>c.CreatedAtUtc)
            .Select(ContainerDetail).ToArray(),
        Clearance=!includeCustoms||x.Clearance is null?null:ClearanceDetail(x.Clearance)
    };
    private static object ContainerDetail(ImportContainer c)=>new
    {
        c.Id,c.ShipmentId,c.Number,c.Size,c.SealNumber,c.GrossWeightKg,
        c.NetWeightKg,c.Status,c.CheckDigitValid,c.InvalidDigitAcknowledged,
        c.ArrivedAtPortDate,c.DeliveredDate,c.FreeTimeEndDate,c.Revision
    };
    private static object ClearanceDetail(ImportCustomsClearance c)=>new
    {
        c.Id,c.ShipmentId,c.BrokerId,c.BrokerSnapshot,c.DeclarationNumber,
        c.SubmittedDate,c.ReleasedDate,c.Status,c.Notes,c.Revision,
        c.ChargesCurrency,c.CustomsValue,c.DutyRatePercent,c.CustomsDutyAmount,
        c.TaxAmount,c.AdditionalFees,c.BrokerFees,c.InlandTransportFees,
        c.DemurrageFees,c.DetentionFees,c.DeliveredToWarehouseDate
    };
    private static void AddAudit(ImportDb db,Guid tenant,Guid order,Guid shipment,
        string entityType,Guid entityId,string action,Guid actor,DateTime utc,
        string before,string after)
    {
        db.LogisticsAudits.Add(new ImportLogisticsAudit {
            TenantId=tenant,OrderId=order,ShipmentId=shipment,
            EntityType=entityType,EntityId=entityId,Action=action,
            ActorId=actor,OccurredAtUtc=utc,BeforeJson=before,AfterJson=after
        });
    }
    private static IResult Bad(LogisticsValidationException ex)=>Results.BadRequest(new{error=ex.Code});
    private static IResult Invalid(string code)=>Results.BadRequest(new{error=code});
    private static IResult Conflict(string code)=>Results.Conflict(new{error=code});
}
