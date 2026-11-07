using System.Diagnostics.CodeAnalysis;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;

namespace Wathiqa.ImportApi;

public sealed class LogisticsValidationException(string code) : Exception(code)
{
    public string Code { get; } = code;
}

public sealed record ShipmentInput(
    string? BlNumber, string? BlType, string? BlOriginalStatus, Guid? ShippingLineId,
    string? Vessel, string? Voyage, string? PortOfLoading, string? PortOfDischarge,
    DateOnly? Etd, DateOnly? Eta, int FreeTimeDays, string? TrackingUrl, int? Revision);

public sealed record ContainerInput(
    string? Number, string? Size, string? SealNumber, decimal? GrossWeightKg,
    decimal? NetWeightKg, string? Status, bool AcknowledgeInvalidDigit,
    DateOnly? ArrivedAtPortDate, DateOnly? DeliveredDate,
    DateOnly? FreeTimeEndDate, int? Revision);

public sealed record ClearanceInput(
    Guid? BrokerId, string? DeclarationNumber, DateOnly? SubmittedDate,
    DateOnly? ReleasedDate, string? Status, string? Notes, int? Revision);

public sealed record ValidatedShipment(
    string BlNumber, string BlType, string BlOriginalStatus, Guid? ShippingLineId,
    string Vessel, string Voyage, string PortOfLoading, string PortOfDischarge,
    DateOnly? Etd, DateOnly? Eta, int FreeTimeDays, string TrackingUrl);

public sealed record ValidatedContainer(
    string Number, string Size, string SealNumber, decimal? GrossWeightKg,
    decimal? NetWeightKg, string Status, bool CheckDigitValid, bool InvalidDigitAcknowledged,
    DateOnly? ArrivedAtPortDate, DateOnly? DeliveredDate, DateOnly? FreeTimeEndDate);

public sealed record ValidatedClearance(
    Guid? BrokerId, string DeclarationNumber, DateOnly? SubmittedDate, DateOnly? ReleasedDate,
    string Status, string Notes);

public static class LogisticsValidation
{
    private static readonly HashSet<string> BlTypes = ["Original","TelexRelease","SeaWaybill"];
    private static readonly HashSet<string> BlStatuses = ["NotReceived","Received","HandedToBroker"];
    private static readonly HashSet<string> ContainerSizes = ["20","40","40HC"];
    private static readonly HashSet<string> ContainerStatuses = ["Planned","AtSea","AtPort","Delivered"];
    private static readonly HashSet<string> ClearanceStatuses =
        ["NotStarted","MissingDocs","UnderInspection","FeesPaid","Released"];
    private static readonly Regex ContainerFormat =
        new("^[A-Z]{3}U[0-9]{7}$",RegexOptions.Compiled|RegexOptions.CultureInvariant);

    public static ValidatedShipment Check(ShipmentInput input)
    {
        var number=Text(input.BlNumber,90,"invalid_bl_number").ToUpperInvariant();
        if(number.Length < 3 || number.Contains(' ')) Invalid("invalid_bl_number");
        var type=Text(input.BlType,20,"invalid_bl_type");
        if(!BlTypes.Contains(type)) Invalid("invalid_bl_type");
        var status=Text(input.BlOriginalStatus,30,"invalid_bl_status");
        if(!BlStatuses.Contains(status)) Invalid("invalid_bl_status");
        if(input.ShippingLineId==Guid.Empty) Invalid("invalid_shipping_line");
        var vessel=Text(input.Vessel,140,"invalid_vessel");
        var voyage=Text(input.Voyage,80,"invalid_voyage");
        var loading=Text(input.PortOfLoading,160,"invalid_loading_port");
        var discharge=Text(input.PortOfDischarge,160,"invalid_discharge_port");
        if(input.FreeTimeDays is < 0 or > 180) Invalid("invalid_free_time");
        if(!DateOk(input.Etd) || !DateOk(input.Eta) ||
            (input.Etd.HasValue && input.Eta.HasValue && input.Eta < input.Etd))
            Invalid("invalid_shipment_dates");
        var tracking=Text(input.TrackingUrl,600,"invalid_tracking_url");
        if(tracking.Length>0 && (!Uri.TryCreate(tracking,UriKind.Absolute,out var url) ||
            url.Scheme!=Uri.UriSchemeHttps || string.IsNullOrWhiteSpace(url.Host) ||
            url.UserInfo.Length>0))
            Invalid("invalid_tracking_url");
        return new ValidatedShipment(number,type,status,input.ShippingLineId,vessel,voyage,
            loading,discharge,input.Etd,input.Eta,input.FreeTimeDays,tracking);
    }

    public static ValidatedContainer Check(ContainerInput input, string? priorStatus=null)
    {
        var number=Regex.Replace((input.Number??"").ToUpperInvariant(),@"[ -]","");
        if(!ContainerFormat.IsMatch(number)) Invalid("invalid_container_number");
        var valid=IsValidContainerNumber(number);
        if(!valid && !input.AcknowledgeInvalidDigit) Invalid("container_check_digit_unacknowledged");
        var size=Text(input.Size,6,"invalid_container_size");
        if(!ContainerSizes.Contains(size)) Invalid("invalid_container_size");
        var seal=Text(input.SealNumber,90,"invalid_seal_number");
        if(input.GrossWeightKg is < 0 or > 100000m ||
            input.NetWeightKg is < 0 or > 100000m ||
            input.GrossWeightKg is { } gross && gross!=decimal.Round(gross,3) ||
            input.NetWeightKg is { } net && net!=decimal.Round(net,3) ||
            input.GrossWeightKg is { } g && input.NetWeightKg is { } n && n>g)
            Invalid("invalid_container_weights");
        var status=Text(input.Status,20,"invalid_container_status");
        if(!ContainerStatuses.Contains(status)) Invalid("invalid_container_status");
        if(priorStatus is not null && Rank(status)<Rank(priorStatus))
            Invalid("container_status_reversal_not_supported");
        if(!DateOk(input.ArrivedAtPortDate)||!DateOk(input.DeliveredDate)||!DateOk(input.FreeTimeEndDate))
            Invalid("invalid_container_dates");
        if(Rank(status)>=Rank("AtPort") && input.ArrivedAtPortDate is null)
            Invalid("arrival_date_required");
        if(status=="Delivered" && input.DeliveredDate is null) Invalid("delivery_date_required");
        if(input.DeliveredDate is { } delivered && input.ArrivedAtPortDate is { } arrived &&
           delivered< arrived) Invalid("invalid_container_dates");
        if(input.FreeTimeEndDate is { } free && input.ArrivedAtPortDate is { } arrival &&
            free<arrival) Invalid("invalid_container_dates");
        if(status=="Planned" && (input.ArrivedAtPortDate.HasValue || input.DeliveredDate.HasValue))
            Invalid("invalid_container_dates");
        return new ValidatedContainer(number,size,seal,input.GrossWeightKg,input.NetWeightKg,status,
            valid,!valid,input.ArrivedAtPortDate,input.DeliveredDate,input.FreeTimeEndDate);
    }

    public static ValidatedClearance Check(ClearanceInput input)
    {
        var status=Text(input.Status,30,"invalid_clearance_status");
        if(!ClearanceStatuses.Contains(status)) Invalid("invalid_clearance_status");
        if(input.BrokerId==Guid.Empty) Invalid("invalid_broker");
        var declaration=Text(input.DeclarationNumber,120,"invalid_declaration_number");
        var notes=Text(input.Notes,3000,"invalid_notes");
        if(!DateOk(input.SubmittedDate)||!DateOk(input.ReleasedDate) ||
            (input.SubmittedDate.HasValue && input.ReleasedDate.HasValue &&
             input.ReleasedDate<input.SubmittedDate))
            Invalid("invalid_clearance_dates");
        if(status=="Released" && input.ReleasedDate is null)
            Invalid("clearance_release_date_required");
        return new ValidatedClearance(input.BrokerId,declaration,input.SubmittedDate,
            input.ReleasedDate,status,notes);
    }

    // ISO 6346 owner letters and six-digit serial, weighted by 2^index;
    // letters skip multiples of eleven. Check digit is (sum % 11) % 10.
    // See Bureau International des Containers official checker.
    public static bool IsValidContainerNumber(string number)
    {
        if(!ContainerFormat.IsMatch(number))return false;
        long sum=0;
        for(var i=0;i<10;i++)
        {
            var c=number[i];
            var value=char.IsDigit(c)?c-'0':10+(c-'A');
            if(char.IsLetter(c)) value+=(value-1)/10;
            sum+=value*(1L<<i);
        }
        return (sum%11)%10 == number[10]-'0';
    }

    public static int Rank(string status) => status switch
    {
        "Planned"=>0, "AtSea"=>1, "AtPort"=>2, "Delivered"=>3, _=>-1
    };
    public static string Text(string? input,int max,string code)
    {
        var text=(input??"").Trim();
        if(text.Length>max || text.Contains('\0')) Invalid(code);
        return text;
    }
    private static bool DateOk(DateOnly? date) => date is null || date.Value.Year is >=2000 and <=2100;
    [DoesNotReturn]
    public static void Invalid(string code)=>throw new LogisticsValidationException(code);
}

public static class LogisticsRollup
{
    // Called after writing shipment/containers/clearance in the SAME
    // transaction. Never accepts client-submitted counts or statuses.
    public static async Task RefreshAsync(ImportDb db,PurchaseOrder order,Guid actor,DateTime now)
    {
        var shipments=await db.Shipments.AsNoTracking()
            .Where(s=>s.OrderId==order.Id)
            .Select(s=>new { s.Id, Clearance=s.Clearance==null?"NotStarted":s.Clearance.Status })
            .ToListAsync();
        var containers=await db.Containers.AsNoTracking()
            .Where(c=>c.Shipment.OrderId==order.Id)
            .Select(c=>c.Status)
            .ToListAsync();
        var count=containers.Count;
        var delivered=containers.Count(s=>s=="Delivered");
        order.ContainerCount=count;
        order.DeliveredContainerCount=delivered;
        order.ArrivalStatus=count==0?"NotShipped" :
            delivered==count?"Delivered" :
            delivered>0?"PartiallyDelivered" :
            containers.Any(s=>s=="AtPort")?"AtPort" :
            containers.Any(s=>s=="AtSea")?"AtSea":"Planned";
        order.ClearanceStatus=shipments.Count==0?"NotStarted":
            shipments.All(s=>s.Clearance=="Released")?"Released":
            shipments.Any(s=>s.Clearance=="Released")?"Partial":
            shipments.Any(s=>s.Clearance!="NotStarted")?"InProgress":"NotStarted";
        order.Revision++;
        order.UpdatedAtUtc=now;
        order.UpdatedById=actor;
    }
}
