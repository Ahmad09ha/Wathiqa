using System.Diagnostics;

namespace Wathiqa.ImportApi;

// WP-09 defense-in-depth: production uploads fail closed if a local AV
// executable cannot be found, times out, errors, or flags the file.
// No user-controlled filename or input is sent through a shell command.
public interface IUploadThreatScanner
{
    Task<string> ScanAsync(string privateTemporaryFile, CancellationToken ct);
}

public sealed class ClamAvUploadThreatScanner : IUploadThreatScanner
{
    private const int MaxScanSeconds=60;
    private readonly string? _executable;
    private readonly bool _development;

    public ClamAvUploadThreatScanner(IConfiguration configuration, IWebHostEnvironment environment)
    {
        _development=environment.IsDevelopment();
        _executable=configuration["Documents:ClamScanExecutable"];
        if(string.IsNullOrWhiteSpace(_executable))
        {
            if(!_development)
                throw new InvalidOperationException(
                    "Documents:ClamScanExecutable must be an absolute path to ClamAV clamscan in non-development environments.");
        }
        else if(!Path.IsPathFullyQualified(_executable) || !File.Exists(_executable))
        {
            throw new InvalidOperationException(
                "Documents:ClamScanExecutable must be an existing absolute executable path.");
        }
    }

    public async Task<string> ScanAsync(string privateTemporaryFile,CancellationToken ct)
    {
        if(string.IsNullOrEmpty(_executable))
        {
            if(!_development)throw new InvalidDocumentException("scanner_unavailable");
            return "SkippedDevelopment";
        }
        // Scan the random, private *.pending path before File.Move and before
        // creating a DB row; no unscanned blob is made visible to readers.
        var options=new ProcessStartInfo
        {
            FileName=_executable,
            UseShellExecute=false,
            CreateNoWindow=true,
            RedirectStandardOutput=true,
            RedirectStandardError=true
        };
        options.ArgumentList.Add("--no-summary");
        options.ArgumentList.Add("--infected");
        options.ArgumentList.Add("--");
        options.ArgumentList.Add(privateTemporaryFile);

        using var linked=CancellationTokenSource.CreateLinkedTokenSource(ct);
        linked.CancelAfter(TimeSpan.FromSeconds(MaxScanSeconds));
        using var process=new Process{StartInfo=options};
        try
        {
            if(!process.Start())throw new InvalidDocumentException("scanner_unavailable");
            // Drain both pipes while the scanner runs so it cannot block on a
            // full OS pipe. Output is deliberately NOT surfaced to clients.
            var output=process.StandardOutput.ReadToEndAsync(linked.Token);
            var error=process.StandardError.ReadToEndAsync(linked.Token);
            await process.WaitForExitAsync(linked.Token);
            await Task.WhenAll(output,error);
            return process.ExitCode switch
            {
                0=>"Clean",
                1=>throw new InvalidDocumentException("document_malware_detected"),
                _=>throw new InvalidDocumentException("scanner_unavailable")
            };
        }
        catch(OperationCanceledException) when(linked.IsCancellationRequested)
        {
            Kill(process);
            if(ct.IsCancellationRequested)throw;
            throw new InvalidDocumentException("scanner_unavailable");
        }
        catch(InvalidDocumentException){throw;}
        catch(Exception ex) when(ex is IOException or System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            Kill(process);
            throw new InvalidDocumentException("scanner_unavailable");
        }
    }

    private static void Kill(Process process)
    {
        try{if(!process.HasExited)process.Kill(entireProcessTree:true);}
        catch(InvalidOperationException){}
        catch(System.ComponentModel.Win32Exception){}
    }
}
