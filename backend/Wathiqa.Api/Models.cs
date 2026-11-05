using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Wathiqa.Api;

public class Template
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string SourceFormat { get; set; } = "blank";
    public string ContentJson { get; set; } = "{\"type\":\"doc\",\"content\":[]}";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public List<Document> Documents { get; set; } = [];
}
public class Document
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? TemplateId { get; set; }
    public Template? Template { get; set; }
    public string Name { get; set; } = "";
    public string ContentJson { get; set; } = "{\"type\":\"doc\",\"content\":[]}";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public int Revision { get; set; } = 1;
}
public class WorkspaceDb(DbContextOptions<WorkspaceDb> options) : DbContext(options)
{
    public DbSet<Template> Templates => Set<Template>();
    public DbSet<Document> Documents => Set<Document>();
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Template>().Property(x => x.ContentJson).HasColumnType("jsonb");
        modelBuilder.Entity<Document>().Property(x => x.ContentJson).HasColumnType("jsonb");
        modelBuilder.Entity<Document>().Property(x => x.Revision).IsConcurrencyToken();
        modelBuilder.Entity<Document>().HasOne(x => x.Template).WithMany(x => x.Documents).HasForeignKey(x => x.TemplateId).OnDelete(DeleteBehavior.SetNull);
    }
}
public record CreateTemplate(string Name, string? Description, JsonElement? Content);
public record CreateDocument(Guid TemplateId, string? Name);
public record SaveContent(string Name, JsonElement Content, int? ExpectedRevision);
