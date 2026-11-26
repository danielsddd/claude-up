# Critique Plan's background helper. The mod can't wait longer than 30 s on a
# web request, so it writes a job file and starts this script, which runs on
# its own: it sends every critic's request with streaming on, keeps waiting as
# long as new output arrives (thinking or writing), and gives up on a critic
# only after $job.stallSec seconds with nothing new, or $job.hardSec in all.
#
# Keys never pass through the mod or this job file: each critic names the
# environment variable that holds its key, read here from the process or the
# Windows user environment.
#
# Per critic it writes <statusFile> (JSON: phase, chars, reasoning, error,
# seconds) about once a second, and <outFile> (the answer) when it finishes.
# It stops early when <cancelFile> appears, and writes <doneFile> at the end.
param([Parameter(Mandatory = $true)][string]$Job)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$utf8 = New-Object Text.UTF8Encoding($false)

$spec = [IO.File]::ReadAllText($Job, $utf8) | ConvertFrom-Json
$stallMs = [int]$spec.stallSec * 1000
$hardMs = [int]$spec.hardSec * 1000

$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromMilliseconds($hardMs + 60000)

function Get-Key([string]$name) {
  $k = [Environment]::GetEnvironmentVariable($name, 'Process')
  if (-not $k) { $k = [Environment]::GetEnvironmentVariable($name, 'User') }
  return $k
}

function Hide-Key($st, [string]$text) {
  if ($st.key) { $text = $text.Replace($st.key, '[key]') }
  $text = ($text -replace '\s+', ' ').Trim()
  if ($text.Length -gt 300) { $text = $text.Substring(0, 300) }
  return $text
}

function Write-Status($st) {
  $o = [ordered]@{
    phase     = $st.phase
    chars     = $st.text.Length
    reasoning = $st.reasoning
    error     = $st.error
    seconds   = [int]([DateTime]::UtcNow - $st.started).TotalSeconds
  }
  [IO.File]::WriteAllText($st.statusFile, ($o | ConvertTo-Json -Compress), $utf8)
  $st.written = [DateTime]::UtcNow
  $st.dirty = $false
}

function Stop-Critic($st, [string]$phase, [string]$err) {
  $st.phase = $phase
  $st.error = $err
  if ($phase -eq 'done') { [IO.File]::WriteAllText($st.outFile, $st.text.ToString(), $utf8) }
  if ($st.reader) { try { $st.reader.Dispose() } catch {} }
  Write-Status $st
}

function Get-ErrorText([string]$body) {
  try {
    $o = $body | ConvertFrom-Json
    if ($o.error.message) { return [string]$o.error.message }
    if ($o.error -is [string]) { return $o.error }
    if ($o.message) { return [string]$o.message }
    if ($o.detail) { return [string]$o.detail }
  } catch {}
  return $body
}

$critics = @()
foreach ($c in $spec.critics) {
  $st = [pscustomobject]@{
    id = $c.id; statusFile = $c.statusFile; outFile = $c.outFile
    key = (Get-Key $c.keyEnv); phase = 'connecting'; error = ''
    text = (New-Object Text.StringBuilder); reasoning = 0
    started = [DateTime]::UtcNow; last = [DateTime]::UtcNow; written = [DateTime]::MinValue
    send = $null; reader = $null; line = $null; dirty = $true
  }
  if (-not $st.key) {
    Stop-Critic $st 'failed' "no key: set $($c.keyEnv) and restart Claude Desktop"
  } else {
    try {
      $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, [string]$c.url)
      [void]$req.Headers.TryAddWithoutValidation('Authorization', "Bearer $($st.key)")
      [void]$req.Headers.TryAddWithoutValidation('Accept', 'text/event-stream')
      $body = [IO.File]::ReadAllText([string]$c.bodyFile, $utf8)
      $req.Content = New-Object System.Net.Http.StringContent($body, $utf8, 'application/json')
      $st.send = $client.SendAsync($req, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead)
      Write-Status $st
    } catch {
      Stop-Critic $st 'failed' (Hide-Key $st $_.Exception.Message)
    }
  }
  $critics += $st
}

while ($true) {
  if (Test-Path -LiteralPath $spec.cancelFile) {
    foreach ($st in $critics) { if ($st.phase -notin 'done', 'failed') { Stop-Critic $st 'failed' 'cancelled' } }
    break
  }
  $active = $false
  foreach ($st in $critics) {
    if ($st.phase -in 'done', 'failed') { continue }
    $active = $true
    $now = [DateTime]::UtcNow
    if (($now - $st.started).TotalMilliseconds -gt $hardMs) {
      Stop-Critic $st 'failed' "no finished answer within $([int]($hardMs / 60000)) min"
      continue
    }
    if (($now - $st.last).TotalMilliseconds -gt $stallMs) {
      $what = if ($st.reader) { 'no new output' } else { 'no response' }
      Stop-Critic $st 'failed' "$what for $([int]($stallMs / 1000)) s"
      continue
    }
    if (-not $st.reader) {
      if (-not $st.send.IsCompleted) { continue }
      if ($st.send.IsFaulted) {
        $e = $st.send.Exception.GetBaseException().Message
        Stop-Critic $st 'failed' (Hide-Key $st $e)
        continue
      }
      $resp = $st.send.Result
      if (-not $resp.IsSuccessStatusCode) {
        $code = [int]$resp.StatusCode
        $raw = ''
        try { $raw = $resp.Content.ReadAsStringAsync().Result } catch {}
        $msg = if ($code -eq 429) { 'free-tier limit reached' } elseif ($code -eq 410 -or $code -eq 404) { 'this provider no longer offers the model' } else { Get-ErrorText $raw }
        Stop-Critic $st 'failed' (Hide-Key $st "HTTP $code`: $msg")
        continue
      }
      $st.reader = New-Object IO.StreamReader($resp.Content.ReadAsStreamAsync().Result, $utf8)
      $st.phase = 'waiting'
      $st.last = $now
      $st.dirty = $true
    }
    for ($n = 0; $n -lt 500; $n++) {
      if ($null -eq $st.line) { $st.line = $st.reader.ReadLineAsync() }
      if (-not $st.line.IsCompleted) { break }
      if ($st.line.IsFaulted) {
        Stop-Critic $st 'failed' (Hide-Key $st $st.line.Exception.GetBaseException().Message)
        break
      }
      $l = $st.line.Result
      $st.line = $null
      if ($null -eq $l) {
        if ($st.text.Length -gt 0) { Stop-Critic $st 'done' '' } else { Stop-Critic $st 'failed' 'empty reply' }
        break
      }
      if (-not $l.StartsWith('data:')) { continue }
      $d = $l.Substring(5).Trim()
      if ($d -eq '[DONE]') {
        if ($st.text.Length -gt 0) { Stop-Critic $st 'done' '' } else { Stop-Critic $st 'failed' 'empty reply' }
        break
      }
      try { $o = $d | ConvertFrom-Json } catch { continue }
      $st.last = [DateTime]::UtcNow
      $st.dirty = $true
      if ($o.error) {
        $m = if ($o.error.message) { [string]$o.error.message } else { [string]$o.error }
        Stop-Critic $st 'failed' (Hide-Key $st $m)
        break
      }
      $delta = $null
      if ($o.choices -and $o.choices.Count -gt 0) { $delta = $o.choices[0].delta }
      if ($null -eq $delta) { continue }
      $r = $delta.reasoning_content
      if (-not $r) { $r = $delta.reasoning }
      if ($r) {
        $st.reasoning += ([string]$r).Length
        if ($st.phase -ne 'writing') { $st.phase = 'thinking' }
      }
      if ($delta.content) {
        [void]$st.text.Append([string]$delta.content)
        $st.phase = 'writing'
      }
    }
    if ($st.phase -notin 'done', 'failed' -and ($st.dirty -or ([DateTime]::UtcNow - $st.written).TotalSeconds -ge 5) -and ([DateTime]::UtcNow - $st.written).TotalMilliseconds -ge 1000) {
      Write-Status $st
    }
  }
  if (-not $active) { break }
  Start-Sleep -Milliseconds 200
}

[IO.File]::WriteAllText($spec.doneFile, 'done', $utf8)
