using System.Text;
using System.Text.Json;
using ClosedXML.Excel;
using DocumentFormat.OpenXml.Packaging;
using Wathiqa.Api;
using Microsoft.EntityFrameworkCore;
using UglyToad.PdfPig;
using UglyToad.PdfPig.DocumentLayoutAnalysis.TextExtractor;

var builder = WebApplication.CreateBuilder(args);
var databaseConnection = builder.Configuration.GetConnectionString("Database");
if (string.IsNullOrWhiteSpace(databaseConnection))
    throw new InvalidOperationException("Missing ConnectionStrings:Database. Start with start.ps1 or set ConnectionStrings__Database.");
builder.Services.AddDbContext<WorkspaceDb>(options =>
    options.UseNpgsql(databaseConnection));
builder.Services.AddCors(options => options.AddPolicy("Web", p =>
    p.WithOrigins("http://localhost:3000", "http://127.0.0.1:3000")
        .AllowAnyHeader().AllowAnyMethod()));
var app = builder.Build();
app.UseCors("Web");

app.MapGet("/api/health", async (WorkspaceDb db) =>
    await db.Database.CanConnectAsync()
        ? Results.Ok(new { status = "ok", database = "connected" })
        : Results.Problem("Database is unavailable.", statusCode: 503));
app.MapGet("/api/templates", async (WorkspaceDb db) => await db.Templates.AsNoTracking()
    .OrderByDescending(x => x.UpdatedAt).Select(x => new { x.Id, x.Name, x.Description, x.SourceFormat, x.UpdatedAt }).ToListAsync());
app.MapGet("/api/templates/{id:guid}", async (Guid id, WorkspaceDb db) =>
    await db.Templates.AsNoTracking().Where(x => x.Id == id).Select(x => new { x.Id, x.Name, x.Description, x.SourceFormat, x.ContentJson, x.UpdatedAt }).FirstOrDefaultAsync() is { } t ? Results.Ok(t) : Results.NotFound());
app.MapPost("/api/templates", async (CreateTemplate request, WorkspaceDb db) =>
{
    var entity = new Template { Name = request.Name.Trim(), Description = request.Description ?? "", ContentJson = request.Content is { } c ? ContentTools.Validate(c) : ContentTools.Empty() };
    if (entity.Name.Length is < 1 or > 160) return Results.BadRequest(new { error = "Template name must be 1-160 characters." });
    db.Templates.Add(entity); await db.SaveChangesAsync();
    return Results.Created($"/api/templates/{entity.Id}", new { entity.Id });
});
app.MapPut("/api/templates/{id:guid}", async (Guid id, SaveContent request, WorkspaceDb db) =>
{
    var t = await db.Templates.FindAsync(id); if (t is null) return Results.NotFound();
    t.Name = request.Name; t.ContentJson = ContentTools.Validate(request.Content); t.UpdatedAt = DateTime.UtcNow;
    await db.SaveChangesAsync(); return Results.Ok(new { t.Id, t.UpdatedAt });
});
app.MapDelete("/api/templates/{id:guid}", async (Guid id, WorkspaceDb db) =>
{
    var entity = await db.Templates.FindAsync(id); if (entity is null) return Results.NotFound();
    db.Templates.Remove(entity); await db.SaveChangesAsync(); return Results.NoContent();
});
app.MapGet("/api/documents", async (WorkspaceDb db) => await db.Documents.AsNoTracking()
    .OrderByDescending(x => x.UpdatedAt)
    .Select(x => new { x.Id, x.Name, x.TemplateId, x.UpdatedAt, x.Revision }).ToListAsync());
app.MapGet("/api/documents/{id:guid}", async (Guid id, WorkspaceDb db) =>
    await db.Documents.AsNoTracking().Where(x => x.Id == id)
        .Select(x => new { x.Id, x.Name, x.TemplateId, x.ContentJson, x.UpdatedAt, x.Revision }).FirstOrDefaultAsync() is { } d ? Results.Ok(d) : Results.NotFound());
app.MapPost("/api/documents", async (CreateDocument request, WorkspaceDb db) =>
{
    var t = await db.Templates.FindAsync(request.TemplateId); if (t is null) return Results.NotFound();
    var d = new Document { TemplateId = t.Id, Name = string.IsNullOrWhiteSpace(request.Name) ? t.Name + " · Copy" : request.Name.Trim(), ContentJson = t.ContentJson };
    db.Documents.Add(d); await db.SaveChangesAsync();
    return Results.Created($"/api/documents/{d.Id}", new { d.Id });
});
app.MapPut("/api/documents/{id:guid}", async (Guid id, SaveContent request, WorkspaceDb db) =>
{
    var d = await db.Documents.FindAsync(id); if (d is null) return Results.NotFound();
    if (request.ExpectedRevision != d.Revision) return Results.Conflict(new { error = "Another edit was saved. Reload before saving.", currentRevision = d.Revision });
    d.Name = request.Name; d.ContentJson = ContentTools.Validate(request.Content); d.UpdatedAt = DateTime.UtcNow; d.Revision++;
    try { await db.SaveChangesAsync(); }
    catch (DbUpdateConcurrencyException) { return Results.Conflict(new { error = "Document changed during save. Reload before retrying." }); }
    return Results.Ok(new { d.Id, d.Revision, d.UpdatedAt });
});
app.MapDelete("/api/documents/{id:guid}", async (Guid id, WorkspaceDb db) =>
{
    var d = await db.Documents.FindAsync(id); if (d is null) return Results.NotFound();
    db.Documents.Remove(d); await db.SaveChangesAsync(); return Results.NoContent();
});
app.MapPost("/api/templates/import", async (IFormFile file, WorkspaceDb db) =>
{
    if (file.Length is 0 or > 10_000_000) return Results.BadRequest(new { error = "File size must be 1 byte to 10 MB." });
    var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
    if (ext is not (".pdf" or ".docx" or ".xlsx")) return Results.BadRequest(new { error = "Supported formats: PDF, DOCX, XLSX." });
    await using var buffer = new MemoryStream();
    await file.CopyToAsync(buffer); buffer.Position = 0;
    var lines = new List<string>();
    try
    {
        if (ext == ".pdf")
        {
            using var pdf = PdfDocument.Open(buffer);
            foreach (var page in pdf.GetPages()) lines.AddRange(ContentOrderTextExtractor.GetText(page).Split('\n', StringSplitOptions.RemoveEmptyEntries));
        }
        else if (ext == ".docx")
        {
            using var word = WordprocessingDocument.Open(buffer, false);
            var body = word.MainDocumentPart?.Document.Body;
            if (body is not null) lines.AddRange(body.ChildElements.Select(x => x.InnerText).Where(x => !string.IsNullOrWhiteSpace(x)));
        }
        else
        {
            using var excel = new XLWorkbook(buffer);
            foreach (var sheet in excel.Worksheets.Take(10))
            {
                lines.Add(sheet.Name);
                foreach (var row in sheet.RowsUsed().Take(1))
                    lines.Add(string.Join("\t", row.CellsUsed().Select(c => c.GetFormattedString())));
            }
        }
    }
    catch (Exception) { return Results.BadRequest(new { error = "Unable to read this file. Verify it is a valid, non-encrypted document." }); }
    if (lines.Count == 0) return Results.BadRequest(new { error = "No extractable text found (scanned PDFs require OCR)." });
    var t = new Template { Name = Path.GetFileNameWithoutExtension(file.FileName), SourceFormat = ext.TrimStart('.'), Description = "Headers/field labels extracted from file · verify imported labels before use", ContentJson = ext == ".xlsx" ? ContentTools.FromLines(lines) : ContentTools.FromLabels(lines) };
    db.Templates.Add(t); await db.SaveChangesAsync();
    return Results.Created($"/api/templates/{t.Id}", new { t.Id, extractedLines = lines.Count });
}).DisableAntiforgery();
app.MapGet("/api/documents/{id:guid}/export/xlsx", async (Guid id, WorkspaceDb db) =>
{
    var d = await db.Documents.FindAsync(id); if (d is null) return Results.NotFound();
    using var workbook = new XLWorkbook();
    var sheet = workbook.Worksheets.Add("Contract");
    var rowIndex = 1;
    foreach (var line in ContentTools.Lines(d.ContentJson).Take(10000))
    {
        var cells = line.Split('\t');
        for (int i = 0; i < Math.Min(cells.Length, 30); i++)
        {
            sheet.Cell(rowIndex, i + 1).Value = cells[i];
            sheet.Cell(rowIndex, i + 1).Style.Alignment.WrapText = true;
        }
        rowIndex++;
    }
    sheet.Columns(1, Math.Min(6, sheet.LastColumnUsed()?.ColumnNumber() ?? 1)).Width = 24;
    using var ms = new MemoryStream(); workbook.SaveAs(ms);
    return Results.File(ms.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ContentTools.SafeName(d.Name) + ".xlsx");
});
app.MapGet("/api/templates/{id:guid}/export/xlsx", async (Guid id, WorkspaceDb db) =>
{
    var t = await db.Templates.FindAsync(id); if (t is null) return Results.NotFound();
    using var workbook = new XLWorkbook();
    var sheet = workbook.Worksheets.Add("Template");
    var row = 1;
    foreach (var line in ContentTools.Lines(t.ContentJson))
    {
        var cells = line.Split('\t');
        for (var column = 0; column < Math.Min(cells.Length, 30); column++)
        {
            sheet.Cell(row, column + 1).Value = cells[column];
            sheet.Cell(row, column + 1).Style.Alignment.WrapText = true;
        }
        row++;
    }
    sheet.Columns(1, Math.Min(6, sheet.LastColumnUsed()?.ColumnNumber() ?? 1)).Width = 24;
    using var stream = new MemoryStream(); workbook.SaveAs(stream);
    return Results.File(stream.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ContentTools.SafeName(t.Name) + ".xlsx");
});
app.MapGet("/", () => Results.Redirect("/api/health"));
await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<WorkspaceDb>();
    try { await Seed.Init(db); }
    catch (Exception e) { app.Logger.LogWarning(e, "Database not connected yet. Start PostgreSQL and restart API."); }
}
app.Run();
