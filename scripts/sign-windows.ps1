param(
  [string]$TargetPath = "release\win-unpacked\知序 ZHIXU.exe",
  [string]$Thumbprint = "252C0ECD64B70B122EF0FEF369120D624B1175D2",
  [string]$PfxPath = $env:ZHIXU_CERT_PFX,
  [string]$PfxPassword = $env:ZHIXU_CERT_PASSWORD,
  [string]$TimestampServer = "http://timestamp.digicert.com"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $TargetPath)) {
  throw "Target binary not found: $TargetPath"
}

$cert = $null
if ($PfxPath -and (Test-Path -LiteralPath $PfxPath)) {
  $secPwd = if ($PfxPassword) {
    ConvertTo-SecureString -String $PfxPassword -AsPlainText -Force
  } else {
    Read-Host -AsSecureString "Enter PFX password"
  }
  $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2
  $cert.Import((Resolve-Path -LiteralPath $PfxPath).Path, $secPwd, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)
} else {
  $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object {
    ($_.Thumbprint -eq $Thumbprint -or $_.Subject -like 'CN=ZHIXU*') -and $_.HasPrivateKey
  } | Sort-Object NotAfter -Descending | Select-Object -First 1
}

if (-not $cert) {
  throw "No code-signing certificate found. Set ZHIXU_CERT_PFX or generate one in Cert:\CurrentUser\My."
}

$result = $null
try {
  $result = Set-AuthenticodeSignature -LiteralPath $TargetPath -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $TimestampServer
} catch {
  $result = Set-AuthenticodeSignature -LiteralPath $TargetPath -Certificate $cert -HashAlgorithm SHA256
}

if ($result.Status -eq 'UnknownError' -or -not $result.SignerCertificate) {
  $result = Set-AuthenticodeSignature -LiteralPath $TargetPath -Certificate $cert -HashAlgorithm SHA256
}

$verify = Get-AuthenticodeSignature -LiteralPath $TargetPath
Write-Output "Signed: $TargetPath"
Write-Output "Status: $($verify.Status) ($($verify.StatusMessage))"
Write-Output "Signer: $($verify.SignerCertificate.Subject)"
Write-Output "Thumbprint: $($verify.SignerCertificate.Thumbprint)"
