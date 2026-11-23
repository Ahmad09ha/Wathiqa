using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Wathiqa.ImportApi;

public sealed record PrivateFileReceipt(string StorageKey,string ContentType,long SizeBytes,string Sha256,string ScanStatus);

public interface IPrivateDocumentStore
{
    Task<PrivateFileReceipt> SaveAsync(IFormFile uploaded,Guid tenantId,CancellationToken ct);
    Stream? TryOpenRead(string storageKey,Guid tenantId);
    void DeleteOrphan(string storageKey,Guid tenantId);
}

public sealed class PrivateDocumentStore : IPrivateDocumentStore
{
    public const long MaxFileBytes=25L*1024*1024;
    public const long MaxRequestBytes=MaxFileBytes+1024*1024;
    private static readonly Regex StorageFormat=new(
        "^[0-9a-f]{32}/[0-9a-f]{32}$",RegexOptions.Compiled|RegexOptions.CultureInvariant);
    private static readonly Dictionary<string,string> Extensions=new(StringComparer.OrdinalIgnoreCase)
    {
        [".pdf"]="application/pdf",[".jpg"]="image/jpeg",
        [".jpeg"]="image/jpeg",[".png"]="image/png"
    };
    private readonly string _root;
    private readonly IUploadThreatScanner _scanner;

    public PrivateDocumentStore(IConfiguration configuration,IWebHostEnvironment environment,IUploadThreatScanner scanner)
    {
        _scanner=scanner;
        var configured=configuration["Documents:PrivateRoot"];
        if(string.IsNullOrWhiteSpace(configured))
        {
            if(!environment.IsDevelopment())
                throw new InvalidOperationException("Documents:PrivateRoot must point to a private persistent volume outside the app before deployment.");
            var userData=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if(string.IsNullOrEmpty(userData))
                throw new InvalidOperationException("Private documents need an explicit Documents:PrivateRoot.");
            configured=Path.Combine(userData,"Wathiqa","ImportPrivateFiles");
        }
        if(!Path.IsPathFullyQualified(configured))
            throw new InvalidOperationException("Documents:PrivateRoot must be an absolute path.");
        _root=Path.GetFullPath(configured);
        var appRoot=Path.GetFullPath(environment.ContentRootPath).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
        if(_root.StartsWith(appRoot,StringComparison.OrdinalIgnoreCase) ||
           Path.GetFullPath(environment.ContentRootPath).Equals(_root,StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Documents:PrivateRoot cannot be inside the application tree.");
        if(environment.WebRootPath is {Length:>0} &&
           (_root.StartsWith(Path.GetFullPath(environment.WebRootPath).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException("Documents:PrivateRoot cannot be inside wwwroot.");
        Directory.CreateDirectory(_root);
    }

    public async Task<PrivateFileReceipt> SaveAsync(IFormFile uploaded,Guid tenantId,CancellationToken ct)
    {
        if(uploaded.Length<=0||uploaded.Length>MaxFileBytes)
            throw new InvalidDocumentException("invalid_document_size");
        var ext=Path.GetExtension(uploaded.FileName);
        if(!Extensions.TryGetValue(ext,out var expected))
            throw new InvalidDocumentException("unsupported_document_format");

        var tenant=tenantId.ToString("N");
        var dir=Path.Combine(_root,tenant);
        Directory.CreateDirectory(dir);
        var blobId=Guid.NewGuid().ToString("N");
        var key=tenant+"/"+blobId;
        var tempPath=Path.Combine(dir,blobId+".pending");
        var finalPath=Path.Combine(dir,blobId);
        var buffer=new byte[64*1024];
        var header=new byte[8];
        var headerRead=0;
        long total=0;
        try
        {
            using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            await using(var dest=new FileStream(tempPath,FileMode.CreateNew,FileAccess.Write,FileShare.None,
                bufferSize:64*1024,FileOptions.Asynchronous))
            await using(var input=uploaded.OpenReadStream())
            {
                int length;
                while((length=await input.ReadAsync(buffer.AsMemory(),ct))>0)
                {
                    total+=length;
                    if(total>MaxFileBytes) throw new InvalidDocumentException("invalid_document_size");
                    if(headerRead<header.Length)
                    {
                        var count=Math.Min(length,header.Length-headerRead);
                        Buffer.BlockCopy(buffer,0,header,headerRead,count);
                        headerRead+=count;
                    }
                    hash.AppendData(buffer,0,length);
                    await dest.WriteAsync(buffer.AsMemory(0,length),ct);
                }
                await dest.FlushAsync(ct);
            }
            if(total==0)throw new InvalidDocumentException("invalid_document_size");
            var detected=Detect(header,headerRead);
            if(detected is null || detected!=expected)
                throw new InvalidDocumentException("invalid_file_signature");
            var scanStatus=await _scanner.ScanAsync(tempPath,ct);
            File.Move(tempPath,finalPath);
            return new PrivateFileReceipt(key,detected,total,
                Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant(),scanStatus);
        }
        catch
        {
            try{File.Delete(tempPath);}catch(IOException){}
            try{File.Delete(finalPath);}catch(IOException){}
            throw;
        }
    }

    public Stream? TryOpenRead(string storageKey,Guid tenantId)
    {
        if(!ValidKey(storageKey,tenantId))return null;
        var filename=Path.Combine(_root,tenantId.ToString("N"),storageKey.Split('/')[1]);
        try {return new FileStream(filename,FileMode.Open,FileAccess.Read,FileShare.Read,
            64*1024,FileOptions.Asynchronous|FileOptions.SequentialScan);}
        catch(FileNotFoundException){return null;}
        catch(DirectoryNotFoundException){return null;}
    }

    public void DeleteOrphan(string storageKey,Guid tenantId)
    {
        if(!ValidKey(storageKey,tenantId))return;
        File.Delete(Path.Combine(_root,tenantId.ToString("N"),storageKey.Split('/')[1]));
    }

    public static string? Detect(byte[] head,int length)
    {
        if(length>=5&&head[0]==0x25&&head[1]==0x50&&head[2]==0x44&&head[3]==0x46&&head[4]==0x2D)
            return "application/pdf";
        if(length>=3&&head[0]==0xFF&&head[1]==0xD8&&head[2]==0xFF)
            return "image/jpeg";
        if(length>=8&&head.AsSpan(0,8).SequenceEqual(new byte[]{137,80,78,71,13,10,26,10}))
            return "image/png";
        return null;
    }
    private static bool ValidKey(string key,Guid tenant)=>
        StorageFormat.IsMatch(key)&&key.StartsWith(tenant.ToString("N")+"/",StringComparison.Ordinal);
}

public sealed class InvalidDocumentException(string code):Exception(code)
{
    public string Code {get;}=code;
}

public static class DocumentFileName
{
    public static string Clean(string raw)
    {
        var name=Path.GetFileName((raw??"").Replace('\\','/')).Trim();
        name=new string(name.Where(c=>!char.IsControl(c)&&c!='"'&&c!='<'&&c!='>'&&c!=':'&&c!='|'&&c!='*').ToArray());
        if(name.Length>180)name=name[..180];
        return string.IsNullOrWhiteSpace(name)?"document":name;
    }
}
