param()
$ErrorActionPreference = 'Stop'
$quotaSource = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$quotaWidget = Join-Path ([IO.Directory]::GetParent($quotaSource).FullName) 'codex-quota-widget'
foreach ($quotaRequired in @('scripts/start-quota.ps1', 'desktop/main.cjs', 'desktop/ui/account-view.js', 'assets/whale-widget.js')) {
    if (!(Test-Path -LiteralPath (Join-Path $quotaWidget $quotaRequired) -PathType Leaf)) {
        throw "缺少挂件程序文件：$quotaRequired。请克隆完整的私有仓库，确保 codex-quota-widget 和 gpt-quota-plugin-source 两个目录相邻；不能只安装插件子目录。"
    }
}
$quotaNode = (Get-Command node.exe -ErrorAction Stop).Source
$quotaCodex = (Get-Command codex.exe -ErrorAction Stop).Source
$quotaMcpPath = Join-Path $quotaSource 'plugins/gpt-quota-widget/.mcp.json'
if (!(Test-Path -LiteralPath $quotaMcpPath)) {
    Copy-Item -LiteralPath (Join-Path $quotaSource 'plugins/gpt-quota-widget/.mcp.example.json') -Destination $quotaMcpPath
}
$quotaMcp = Get-Content -LiteralPath $quotaMcpPath -Raw -Encoding UTF8 | ConvertFrom-Json
$quotaMcp.mcpServers.gpt_quota_widget.command = $quotaNode
$quotaMcp.mcpServers.gpt_quota_widget.env.GPT_QUOTA_WIDGET_ROOT = $quotaWidget
# A live MCP process can keep its Windows cache directory locked. When its
# binding changes, install a fresh patch version instead of replacing that folder.
$quotaManifestPath = Join-Path $quotaSource 'plugins/gpt-quota-widget/.codex-plugin/plugin.json'
$quotaManifest = Get-Content -LiteralPath $quotaManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$quotaConfigHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$quotaCacheRoot = Join-Path $quotaConfigHome 'plugins/cache/gpt-quota-local/gpt-quota-widget'
$quotaCachedMcp = Join-Path (Join-Path $quotaCacheRoot $quotaManifest.version) '.mcp.json'
if (Test-Path -LiteralPath $quotaCachedMcp) {
    $quotaCached = Get-Content -LiteralPath $quotaCachedMcp -Raw -Encoding UTF8 | ConvertFrom-Json
    $quotaOldRoot = $quotaCached.mcpServers.gpt_quota_widget.env.GPT_QUOTA_WIDGET_ROOT
    $quotaOldNode = $quotaCached.mcpServers.gpt_quota_widget.command
    if ([IO.Path]::GetFullPath($quotaOldRoot) -ne [IO.Path]::GetFullPath($quotaWidget) -or [IO.Path]::GetFullPath($quotaOldNode) -ne [IO.Path]::GetFullPath($quotaNode)) {
        $quotaVersion = [Version]$quotaManifest.version
        $quotaPatch = [Math]::Max(0, $quotaVersion.Build)
        do { $quotaPatch++; $quotaNext = '{0}.{1}.{2}' -f $quotaVersion.Major,$quotaVersion.Minor,$quotaPatch } while (Test-Path -LiteralPath (Join-Path $quotaCacheRoot $quotaNext))
        $quotaManifest.version = $quotaNext
        [IO.File]::WriteAllText($quotaManifestPath, ($quotaManifest | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
    }
}
[IO.File]::WriteAllText($quotaMcpPath, ($quotaMcp | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
& $quotaCodex plugin marketplace add $quotaSource --json
if ($LASTEXITCODE -ne 0) { throw 'Could not register the local plugin marketplace.' }
& $quotaCodex plugin add gpt-quota-widget@gpt-quota-local --json
if ($LASTEXITCODE -ne 0) { throw 'Could not install the GPT quota widget plugin.' }
Write-Output 'Plugin installed. Open a new Codex chat to load the updated paths.'
