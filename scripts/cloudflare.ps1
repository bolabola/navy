param(
  [switch]$CreateDeployToken,
  [switch]$SetToken,
  [switch]$PrepareKv,
  [switch]$SetSecrets,
  [switch]$Deploy,
  [switch]$All,
  [switch]$Wizard,
  [string]$AccountId = "",
  [string]$WorkerName = "board-trello",
  [string]$KvBinding = "BOARD_KV",
  [string]$TokenName = "board-trello-deploy",
  [switch]$SaveTokenToUserEnvironment,
  [switch]$SaveTokenToLocalFile,
  [switch]$InsecureSkipTlsVerify
)

$ErrorActionPreference = "Stop"
$ApiBase = "https://api.cloudflare.com/client/v4"
$LocalTokenFile = ".cloudflare-token.local"
$WranglerToml = "wrangler.toml"
$DeployWranglerToml = ".wrangler.deploy.toml"
$ExplicitAction = $CreateDeployToken -or $SetToken -or $PrepareKv -or $SetSecrets -or $Deploy -or $All

if ($All) {
  $PrepareKv = $true
  $SetSecrets = $true
  $Deploy = $true
}

if (-not $ExplicitAction) {
  $Wizard = $true
}

if ($InsecureSkipTlsVerify) {
  $env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
}

[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

function Read-SecretPlainText($Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $plain = [System.Net.NetworkCredential]::new("", $secure).Password
  if ([string]::IsNullOrWhiteSpace($plain)) {
    throw "$Prompt cannot be empty."
  }
  return $plain
}

function Read-YesNo($Prompt, $DefaultYes = $true) {
  $suffix = if ($DefaultYes) { "Y/n" } else { "y/N" }
  $answer = (Read-Host "$Prompt [$suffix]").Trim()
  if ([string]::IsNullOrWhiteSpace($answer)) {
    return $DefaultYes
  }
  return $answer -match "^(y|yes)$"
}

function Read-Choice($Prompt, $Default, $Choices) {
  $choiceText = ($Choices | ForEach-Object { "$($_.Key)=$($_.Label)" }) -join ", "
  while ($true) {
    $answer = (Read-Host "$Prompt [$choiceText, default: $Default]").Trim()
    if ([string]::IsNullOrWhiteSpace($answer)) {
      return $Default
    }
    $match = $Choices | Where-Object { $_.Key -eq $answer } | Select-Object -First 1
    if ($match) {
      return $match.Key
    }
    Write-Host "Invalid choice."
  }
}

function Save-DeployToken($Token) {
  $env:CLOUDFLARE_API_TOKEN = $Token

  if ($SaveTokenToUserEnvironment) {
    [Environment]::SetEnvironmentVariable("CLOUDFLARE_API_TOKEN", $Token, "User")
    Write-Host "Deploy token saved to the current Windows user environment."
  }

  if ($SaveTokenToLocalFile) {
    Set-Content -LiteralPath $LocalTokenFile -Value $Token -NoNewline -Encoding ascii
    Write-Host "Deploy token saved to $LocalTokenFile. This file is gitignored; treat it like a password."
  }
}

function Get-DeployToken {
  $token = $env:CLOUDFLARE_API_TOKEN
  if ([string]::IsNullOrWhiteSpace($token)) {
    $token = [Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "User")
  }
  if ([string]::IsNullOrWhiteSpace($token) -and (Test-Path $LocalTokenFile)) {
    $token = (Get-Content -Raw $LocalTokenFile).Trim()
  }
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw "CLOUDFLARE_API_TOKEN is not set. Run scripts/cloudflare.ps1 -SetToken or -CreateDeployToken first."
  }
  $env:CLOUDFLARE_API_TOKEN = $token
  return $token
}

function Test-DeployTokenAvailable {
  $token = $env:CLOUDFLARE_API_TOKEN
  if ([string]::IsNullOrWhiteSpace($token)) {
    $token = [Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "User")
  }
  if ([string]::IsNullOrWhiteSpace($token) -and (Test-Path $LocalTokenFile)) {
    $token = (Get-Content -Raw $LocalTokenFile).Trim()
  }
  return -not [string]::IsNullOrWhiteSpace($token)
}

function Invoke-CloudflareApi($Method, $Path, $Token, $Body = $null) {
  $headers = @{
    Authorization = "Bearer $Token"
    "Content-Type" = "application/json"
  }
  $uri = "$ApiBase$Path"

  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
  }

  $json = $Body | ConvertTo-Json -Depth 20
  return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -Body $json
}

function Resolve-AccountId($Token, $ProvidedAccountId) {
  if (-not [string]::IsNullOrWhiteSpace($ProvidedAccountId)) {
    return $ProvidedAccountId.Trim()
  }

  try {
    $accountsResponse = Invoke-CloudflareApi "GET" "/accounts" $Token
    $accounts = @($accountsResponse.result)
    if ($accounts.Count -eq 1) {
      Write-Host "Using Cloudflare account: $($accounts[0].name) ($($accounts[0].id))"
      return $accounts[0].id
    }
    if ($accounts.Count -gt 1) {
      Write-Host "Available accounts:"
      for ($i = 0; $i -lt $accounts.Count; $i += 1) {
        Write-Host "[$($i + 1)] $($accounts[$i].name) ($($accounts[$i].id))"
      }
      $choice = Read-Host "Select account number"
      $index = [int]$choice - 1
      if ($index -ge 0 -and $index -lt $accounts.Count) {
        return $accounts[$index].id
      }
      throw "Invalid account selection."
    }
  } catch {
    Write-Host "Could not list accounts with the token: $($_.Exception.Message)"
  }

  $manual = (Read-Host "Cloudflare Account ID").Trim()
  if ($manual -notmatch "^[0-9a-fA-F]{32}$") {
    throw "Cloudflare Account ID should be a 32-character hex string."
  }
  return $manual
}

function Find-PermissionGroup($Groups, $Scope, $Patterns) {
  foreach ($pattern in $Patterns) {
    $match = $Groups | Where-Object {
      @($_.scopes) -contains $Scope -and $_.name -match $pattern
    } | Select-Object -First 1
    if ($match) {
      Write-Host "Using permission group: $($match.name)"
      return @{ id = $match.id; meta = @{} }
    }
  }

  $available = $Groups | Where-Object { @($_.scopes) -contains $Scope } | Select-Object -ExpandProperty name
  throw "Could not find required permission group for scope $Scope. Available groups: $($available -join ', ')"
}

function New-RandomHexSecret {
  $bytes = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
    return ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
  } finally {
    $rng.Dispose()
  }
}

function Update-DeployWranglerConfig($NamespaceId) {
  if (-not (Test-Path $WranglerToml)) {
    throw "$WranglerToml was not found."
  }

  $content = Get-Content -Raw $WranglerToml
  if ($content -notmatch "(?m)^\s*\[\[kv_namespaces\]\]\s*$") {
    $content = $content -replace '(?m)^(binding\s*=\s*"[^"]+"\s*)$', "[[kv_namespaces]]`r`n`$1"
  }
  $updated = $content -replace 'id = "REPLACE_WITH_KV_ID"', "id = `"$NamespaceId`""
  if ($updated -eq $content -and $content -notmatch [regex]::Escape($NamespaceId)) {
    $updated = $content -replace 'id = "[0-9a-fA-F]{32}"', "id = `"$NamespaceId`""
  }
  Set-Content -LiteralPath $DeployWranglerToml -Value $updated -Encoding utf8
  Write-Host "Wrote local deploy config $DeployWranglerToml with KV namespace id $NamespaceId."
  Write-Host "$WranglerToml remains safe to commit with REPLACE_WITH_KV_ID."
}

function Invoke-SetToken {
  $token = Read-SecretPlainText "CLOUDFLARE_API_TOKEN"
  Save-DeployToken $token
  Write-Host "Token is available for this PowerShell session."
}

function Invoke-CreateDeployToken {
  Write-Host "Paste a bootstrap token created with the Cloudflare 'Create additional tokens' template."
  $bootstrapToken = Read-SecretPlainText "Bootstrap CLOUDFLARE_API_TOKEN"
  $resolvedAccountId = Resolve-AccountId $bootstrapToken $AccountId
  $permissionResponse = Invoke-CloudflareApi "GET" "/user/tokens/permission_groups" $bootstrapToken
  $groups = @($permissionResponse.result)
  $accountScope = "com.cloudflare.api.account"
  $permissionGroups = @(
    (Find-PermissionGroup $groups $accountScope @("^Workers Scripts (Edit|Write)$")),
    (Find-PermissionGroup $groups $accountScope @("^Workers KV Storage (Edit|Write)$")),
    (Find-PermissionGroup $groups $accountScope @("^Account Settings Read$"))
  )

  $resources = @{}
  $resources["com.cloudflare.api.account.$resolvedAccountId"] = "*"
  $body = @{
    name = $TokenName
    policies = @(
      @{
        effect = "allow"
        resources = $resources
        permission_groups = $permissionGroups
      }
    )
  }

  $createdResponse = Invoke-CloudflareApi "POST" "/user/tokens" $bootstrapToken $body
  if (-not $createdResponse.success) {
    throw "Cloudflare did not create the token."
  }

  $created = $createdResponse.result
  $deployToken = $created.value
  if ([string]::IsNullOrWhiteSpace($deployToken) -and $created.token) {
    $deployToken = $created.token
  }
  if ([string]::IsNullOrWhiteSpace($deployToken)) {
    throw "Token was created, but Cloudflare did not return the token value."
  }

  Save-DeployToken $deployToken
  Write-Host "Deploy token created. Token id: $($created.id)"
}

function Invoke-PrepareKv {
  $token = Get-DeployToken
  $resolvedAccountId = Resolve-AccountId $token $AccountId
  $namespacesResponse = Invoke-CloudflareApi "GET" "/accounts/$resolvedAccountId/storage/kv/namespaces" $token
  $namespaces = @($namespacesResponse.result)
  $namespace = $namespaces | Where-Object { $_.title -eq $KvBinding } | Select-Object -First 1
  if (-not $namespace) {
    $created = Invoke-CloudflareApi "POST" "/accounts/$resolvedAccountId/storage/kv/namespaces" $token @{ title = $KvBinding }
    if (-not $created.success) {
      throw "Cloudflare did not create KV namespace $KvBinding."
    }
    $namespace = $created.result
    Write-Host "Created KV namespace $KvBinding ($($namespace.id))."
  } else {
    Write-Host "Using existing KV namespace $KvBinding ($($namespace.id))."
  }
  Update-DeployWranglerConfig $namespace.id
}

function Invoke-SetSecrets {
  $token = Get-DeployToken
  $resolvedAccountId = Resolve-AccountId $token $AccountId
  Write-Host "Enter the production admin password. It will not be displayed."
  $adminPassword = Read-SecretPlainText "ADMIN_PASSWORD"
  if ($adminPassword.Length -lt 16) {
    throw "ADMIN_PASSWORD should be at least 16 characters for production."
  }
  $sessionSecret = New-RandomHexSecret
  foreach ($secret in @(
    @{ name = "ADMIN_PASSWORD"; text = $adminPassword },
    @{ name = "SESSION_SECRET"; text = $sessionSecret }
  )) {
    $body = @{
      name = $secret.name
      text = $secret.text
      type = "secret_text"
    }
    $response = Invoke-CloudflareApi "PUT" "/accounts/$resolvedAccountId/workers/scripts/$WorkerName/secrets" $token $body
    if (-not $response.success) {
      throw "Cloudflare API failed to set $($secret.name)."
    }
    Write-Host "Set secret: $($secret.name)"
  }
}

function Invoke-Deploy {
  $null = Get-DeployToken
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    throw "Node.js is not available on PATH. Install Node.js or run Wrangler directly with your local Node executable."
  }
  $wranglerCli = Join-Path (Get-Location) "node_modules\wrangler\bin\wrangler.js"
  if (-not (Test-Path $wranglerCli)) {
    throw "Wrangler CLI was not found. Run npm install first."
  }
  $deployArgs = @("deploy")
  if (Test-Path $DeployWranglerToml) {
    $deployArgs += @("--config", $DeployWranglerToml)
  }
  & $node.Source $wranglerCli @deployArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Wrangler deploy failed with exit code $LASTEXITCODE."
  }
}

function Invoke-DeployWithRetry {
  try {
    Invoke-Deploy
    return
  } catch {
    if ($InsecureSkipTlsVerify) {
      throw
    }

    Write-Host "Deploy failed: $($_.Exception.Message)"
    Write-Host "If your network uses a proxy or VPN that breaks Wrangler TLS validation, you can retry with NODE_TLS_REJECT_UNAUTHORIZED=0."
    Write-Host "Only use this on your own trusted network."
    if (-not (Read-YesNo "Retry deploy with insecure TLS verification disabled" $false)) {
      throw
    }

    $script:InsecureSkipTlsVerify = $true
    $env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
    Invoke-Deploy
  }
}

function Invoke-Wizard {
  Write-Host "Cloudflare deployment wizard for $WorkerName"

  if (-not (Test-DeployTokenAvailable)) {
    Write-Host "No deploy token was found in the session, user environment, or $LocalTokenFile."
    $mode = Read-Choice "Choose token setup" "1" @(
      @{ Key = "1"; Label = "paste existing deploy token" },
      @{ Key = "2"; Label = "create deploy token from bootstrap token" }
    )
    $saveLocal = Read-YesNo "Save deploy token to $LocalTokenFile for this project" $true
    $script:SaveTokenToLocalFile = $saveLocal
    if ($mode -eq "1") {
      Invoke-SetToken
    } else {
      Invoke-CreateDeployToken
    }
  } else {
    $null = Get-DeployToken
    Write-Host "Using existing deploy token."
  }

  if (Read-YesNo "Prepare KV namespace and local deploy config" $true) {
    Invoke-PrepareKv
  }

  if (Read-YesNo "Set or reset production ADMIN_PASSWORD and SESSION_SECRET" $false) {
    Invoke-SetSecrets
  }

  if (Read-YesNo "Deploy now" $true) {
    Invoke-DeployWithRetry
  }
}

if ($Wizard) { Invoke-Wizard; return }
if ($SetToken) { Invoke-SetToken }
if ($CreateDeployToken) { Invoke-CreateDeployToken }
if ($PrepareKv) { Invoke-PrepareKv }
if ($SetSecrets) { Invoke-SetSecrets }
if ($Deploy) { Invoke-DeployWithRetry }
