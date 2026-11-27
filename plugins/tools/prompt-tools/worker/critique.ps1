# Critique Plan's background helper. A mod can't wait longer than 30 s on a web
# request, so the mod writes a job file and starts this script, which runs on its
# own and reports through small JSON files the mod polls.
#
# Critics: each slot streams one model's critique. When a model fails before
# finishing (rate limit, retired, out of free quota, no key, silent for stallSec)
# the slot moves to its next candidate. Free only: OpenRouter is used only for
# ":free" models and only while the account shows no spend or credits.
#
# Fact check (optional): a fast model lists the plan's checkable claims, then each
# one gets a Tavily search, after a free check of the Tavily usage (never past the
# free plan, never with pay-as-you-go usage). One Tavily research call runs only
# when the job asks for it.
#
# Keys never pass through the mod or the job file: each candidate names the
# environment variable that holds its key, read here (process, then user scope).
param([Parameter(Mandatory = $true)][string]$Job)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.Web.Extensions
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# .NET Framework allows 2 connections per host by default, which queued three
# NVIDIA critics behind each other until they timed out.
[Net.ServicePointManager]::DefaultConnectionLimit = 32
# ConvertFrom-Json is far too slow for one call per streamed token.
$jss = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$jss.MaxJsonLength = [int]::MaxValue
$utf8 = New-Object Text.UTF8Encoding($false)
$UA = 'claude-up-critique-plan/0.7'

$spec = [IO.File]::ReadAllText($Job, $utf8) | ConvertFrom-Json
$plan = [IO.File]::ReadAllText([string]$spec.planFile, $utf8)
$stallMs = [int]$spec.stallSec * 1000
$hardMs = [int]$spec.hardSec * 1000

$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromMilliseconds($hardMs + 60000)
$allKeys = New-Object System.Collections.Generic.List[string]

# ---------- small helpers ----------

function Get-Key([string]$name) {
  $k = [Environment]::GetEnvironmentVariable($name, 'Process')
  if (-not $k) { $k = [Environment]::GetEnvironmentVariable($name, 'User') }
  if (-not $k -and $name -eq 'TAVILY_API_KEY') {
    $cfg = Join-Path $env:USERPROFILE '.tavily\config.json'
    if (Test-Path -LiteralPath $cfg) { try { $k = ([IO.File]::ReadAllText($cfg, $utf8) | ConvertFrom-Json).api_key } catch {} }
  }
  if ($k -and -not $allKeys.Contains($k)) { $allKeys.Add($k) }
  return $k
}

function Hide-Keys([string]$text) {
  foreach ($k in $allKeys) { if ($k) { $text = $text.Replace($k, '[key]') } }
  $text = ($text -replace '\s+', ' ').Trim()
  if ($text.Length -gt 240) { $text = $text.Substring(0, 240) }
  return $text
}

function Write-Json([string]$path, $obj) {
  [IO.File]::WriteAllText($path, ($obj | ConvertTo-Json -Depth 8 -Compress), $utf8)
}

function Get-ErrorText([string]$body) {
  try {
    $o = $body | ConvertFrom-Json
    if ($o -is [array]) { $o = $o[0] }
    if ($o.error.message) { return [string]$o.error.message }
    if ($o.error -is [string]) { return $o.error }
    if ($o.message) { return [string]$o.message }
    if ($o.detail) { return [string]$o.detail }
  } catch {}
  return $body
}

function New-Request([string]$method, [string]$url, [string]$key, [string]$json) {
  $req = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod($method)), $url)
  [void]$req.Headers.TryAddWithoutValidation('Authorization', "Bearer $key")
  [void]$req.Headers.TryAddWithoutValidation('User-Agent', $UA)
  if ($json) { $req.Content = New-Object System.Net.Http.StringContent($json, $utf8, 'application/json') }
  return $req
}

# A short blocking call for checks that cost nothing (usage, key state).
function Get-JsonNow([string]$url, [string]$key) {
  $req = New-Request 'GET' $url $key $null
  $t = $client.SendAsync($req)
  if (-not $t.Wait(15000)) { throw 'timed out' }
  $resp = $t.Result
  $body = $resp.Content.ReadAsStringAsync().Result
  if (-not $resp.IsSuccessStatusCode) { throw "HTTP $([int]$resp.StatusCode): $(Get-ErrorText $body)" }
  return $body | ConvertFrom-Json
}

function Next-Midnight { return [DateTime]::UtcNow.Date.AddDays(1).ToString('o') }
function Today { return [DateTime]::UtcNow.ToString('yyyy-MM-dd') }

# ---------- providers.json: free-only switches that outlive a run ----------

$state = @{}
if ($spec.stateFile -and (Test-Path -LiteralPath $spec.stateFile)) {
  try {
    $raw = [IO.File]::ReadAllText([string]$spec.stateFile, $utf8) | ConvertFrom-Json
    foreach ($p in $raw.PSObject.Properties) { $state[$p.Name] = $p.Value }
  } catch {}
}

function Save-State {
  if (-not $spec.stateFile) { return }
  $dir = Split-Path -Parent ([string]$spec.stateFile)
  if (-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
  $o = [ordered]@{}
  foreach ($k in $state.Keys) { $o[$k] = $state[$k] }
  Write-Json ([string]$spec.stateFile) $o
}

# ---------- usage.json: local counts per model (today and in total), shown next to each critic ----------

$usagePath = $null
if ($spec.stateFile) { $usagePath = Join-Path (Split-Path -Parent ([string]$spec.stateFile)) 'usage.json' }

function Add-Usage($c, [int]$tokens) {
  if (-not $usagePath -or -not $c) { return $null }
  $all = [ordered]@{}
  try {
    if (Test-Path -LiteralPath $usagePath) {
      $raw = [IO.File]::ReadAllText($usagePath, $utf8) | ConvertFrom-Json
      foreach ($p in $raw.PSObject.Properties) { $all[$p.Name] = $p.Value }
    }
  } catch {}
  $k = "$($c.keyEnv)|$($c.model)"
  $u = $all[$k]
  $day = Today
  if (-not $u) { $u = [pscustomobject]@{ day = $day; todayRequests = 0; todayTokens = 0; totalRequests = 0; totalTokens = 0 } }
  if ($u.day -ne $day) { $u.day = $day; $u.todayRequests = 0; $u.todayTokens = 0 }
  $u.todayRequests = [int]$u.todayRequests + 1
  $u.todayTokens = [long]$u.todayTokens + $tokens
  $u.totalRequests = [int]$u.totalRequests + 1
  $u.totalTokens = [long]$u.totalTokens + $tokens
  $all[$k] = $u
  # The folder may not exist yet (providers.json is only written when a switch changes):
  # without it the write failed and every run's total restarted from zero.
  try {
    $dir = Split-Path -Parent $usagePath
    if (-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
    Write-Json $usagePath $all
  } catch {}
  return $u
}

function Get-Off([string]$keyEnv, [string]$model) {
  foreach ($k in @("$keyEnv|$model", "$keyEnv|*")) {
    $e = $state[$k]
    if (-not $e) { continue }
    if ($e.until -eq 'never') { return [string]$e.comment }
    try { if ([DateTime]::Parse([string]$e.until).ToUniversalTime() -gt [DateTime]::UtcNow) { return [string]$e.comment } } catch {}
  }
  return $null
}

function Set-Off([string]$keyEnv, [string]$model, [string]$until, [string]$comment) {
  $state["$keyEnv|$model"] = [pscustomobject]@{ until = $until; comment = $comment }
  Save-State
}

# OpenRouter: free models only, and only while the account shows no spend or credits.
$openRouterOk = $null
function Test-OpenRouter([string]$key) {
  if ($null -ne $script:openRouterOk) { return $script:openRouterOk }
  try {
    $k = Get-JsonNow 'https://openrouter.ai/api/v1/key' $key
    $c = Get-JsonNow 'https://openrouter.ai/api/v1/credits' $key
    if ([double]$k.data.usage -gt 0 -or [double]$c.data.total_credits -gt 0) {
      Set-Off 'OPENROUTER_API_KEY' '*' 'never' 'spend or credits detected; free credits only'
      $script:openRouterOk = $false
    } else { $script:openRouterOk = $true }
  } catch { $script:openRouterOk = $false }
  return $script:openRouterOk
}

# ---------- critics ----------

function Write-SlotStatus($s) {
  $name = ''
  if ($s.cand) { $name = [string]$s.cand.name }
  $o = [ordered]@{
    phase = $s.phase; model = $name; tried = @($s.tried); chars = $s.text.Length
    reasoning = $s.reasoning; error = $s.error
    seconds = [int]([DateTime]::UtcNow - $s.runStart).TotalSeconds
    tokens = $s.tokens; dayLimit = $s.dayLimit; dayLeft = $s.dayLeft
    todayRequests = 0; totalTokens = 0
  }
  if ($s.usage) { $o.todayRequests = [int]$s.usage.todayRequests; $o.totalTokens = [long]$s.usage.totalTokens }
  Write-Json $s.statusFile $o
  $s.written = [DateTime]::UtcNow
  $s.dirty = $false
}

function Close-Stream($s) {
  if ($s.reader) { try { $s.reader.Dispose() } catch {} }
  $s.reader = $null; $s.send = $null; $s.line = $null; $s.carry = ''
}

function Start-Next($s) {
  Close-Stream $s
  while ($s.idx -lt $s.cands.Count) {
    $c = $s.cands[$s.idx]
    $s.idx++
    $s.cand = $c
    $off = Get-Off ([string]$c.keyEnv) ([string]$c.model)
    if ($off) { $s.tried += "$($c.name): off ($off)"; continue }
    $key = Get-Key ([string]$c.keyEnv)
    if (-not $key) { $s.tried += "$($c.name): no key ($($c.keyEnv))"; continue }
    if ($c.keyEnv -eq 'OPENROUTER_API_KEY') {
      if (-not ([string]$c.model).EndsWith(':free')) { $s.tried += "$($c.name): not a free model"; continue }
      if (-not (Test-OpenRouter $key)) { $s.tried += "$($c.name): OpenRouter off (free only)"; continue }
    }
    try {
      $text = $plan
      if ($text.Length -gt [int]$c.planCap) { $text = $text.Substring(0, [int]$c.planCap) + "`n`n[plan cut at $($c.planCap) characters]" }
      $body = [ordered]@{ model = [string]$c.model; stream = $true; stream_options = [ordered]@{ include_usage = $true } }
      if ($c.params) { foreach ($p in $c.params.PSObject.Properties) { $body[$p.Name] = $p.Value } }
      $body.messages = @(
        [ordered]@{ role = 'system'; content = "$($spec.system)`n$($s.focus)" },
        [ordered]@{ role = 'user'; content = "The plan to critique:`n`"`"`"`n$text`n`"`"`"" }
      )
      $req = New-Request 'POST' ([string]$c.url) $key ($body | ConvertTo-Json -Depth 8 -Compress)
      [void]$req.Headers.TryAddWithoutValidation('Accept', 'text/event-stream')
      $s.send = $client.SendAsync($req, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead)
      $s.text = New-Object Text.StringBuilder
      $s.reasoning = 0
      $s.tokens = 0; $s.dayLimit = 0; $s.dayLeft = -1; $s.usage = $null
      $s.phase = 'connecting'
      $s.started = [DateTime]::UtcNow
      $s.last = [DateTime]::UtcNow
      Write-SlotStatus $s
      return
    } catch {
      $s.tried += "$($c.name): $(Hide-Keys $_.Exception.Message)"
    }
  }
  $s.cand = $null
  $s.phase = 'failed'
  $s.error = 'every model failed'
  Write-SlotStatus $s
}

function Fail-Candidate($s, [string]$why) {
  $s.tried += "$($s.cand.name): $why"
  Start-Next $s
}

# Classifies an HTTP failure; switches a provider off when its free quota is used up.
function Get-HttpWhy($c, [int]$code, [string]$raw) {
  $msg = Hide-Keys (Get-ErrorText $raw)
  if ($code -eq 429) {
    if ($c.keyEnv -eq 'OPENROUTER_API_KEY' -and $raw -match 'free-models-per-day') {
      Set-Off 'OPENROUTER_API_KEY' '*' (Next-Midnight) "free daily requests used up on $(Today)"
      return 'free daily requests used up'
    }
    if ($c.keyEnv -eq 'GEMINI_API_KEY' -and $raw -match 'quota') {
      Set-Off 'GEMINI_API_KEY' ([string]$c.model) (Next-Midnight) "free daily quota used up on $(Today)"
      return 'free daily quota used up'
    }
    return 'rate-limited'
  }
  if ($code -eq 402) {
    Set-Off ([string]$c.keyEnv) '*' 'never' "billing required (HTTP 402); free only"
    return 'billing required'
  }
  if ($code -eq 404 -or $code -eq 410) { return 'model retired or not offered' }
  if ($code -eq 503) { return 'overloaded' }
  return "HTTP $code`: $msg"
}

$slots = @()
foreach ($sl in $spec.slots) {
  $s = [pscustomobject]@{
    id = $sl.id; focus = [string]$sl.focus; statusFile = $sl.statusFile; outFile = $sl.outFile
    cands = @($sl.candidates); idx = 0; cand = $null; phase = 'connecting'; error = ''; tried = @()
    text = (New-Object Text.StringBuilder); reasoning = 0
    runStart = [DateTime]::UtcNow; started = [DateTime]::UtcNow; last = [DateTime]::UtcNow
    written = [DateTime]::MinValue; send = $null; reader = $null; line = $null; dirty = $true
    buf = (New-Object byte[] 65536); cbuf = (New-Object char[] 65536); decoder = $null; carry = ''
    tokens = 0; dayLimit = 0; dayLeft = -1; usage = $null
  }
  Start-Next $s
  $slots += $s
}

function Finish-Slot($s) {
  if ($s.text.Length -gt 0) {
    [IO.File]::WriteAllText($s.outFile, $s.text.ToString(), $utf8)
    $s.usage = Add-Usage $s.cand $s.tokens
    Close-Stream $s
    $s.phase = 'done'
    Write-SlotStatus $s
  } else { Fail-Candidate $s 'empty reply' }
}

function Step-Slot($s) {
  $now = [DateTime]::UtcNow
  # A candidate's own maxSec (a slow model with a faster fallback) wins over the job's limit.
  $limitMs = $hardMs
  if ($s.cand -and $s.cand.maxSec) { $limitMs = [Math]::Min($hardMs, [int]$s.cand.maxSec * 1000) }
  if (($now - $s.started).TotalMilliseconds -gt $limitMs) { Fail-Candidate $s "no finished answer within $([int]($limitMs / 1000))s"; return }
  if (($now - $s.last).TotalMilliseconds -gt $stallMs) {
    $what = 'no response'
    if ($s.reader) { $what = 'no new output' }
    Fail-Candidate $s "$what for $([int]($stallMs / 1000)) s"
    return
  }
  if (-not $s.reader) {
    if (-not $s.send.IsCompleted) { return }
    if ($s.send.IsFaulted) { Fail-Candidate $s (Hide-Keys $s.send.Exception.GetBaseException().Message); return }
    $resp = $s.send.Result
    if (-not $resp.IsSuccessStatusCode) {
      $raw = ''
      try { $raw = $resp.Content.ReadAsStringAsync().Result } catch {}
      Fail-Candidate $s (Get-HttpWhy $s.cand ([int]$resp.StatusCode) $raw)
      return
    }
    # Groq reports the account's daily request limit and what is left; others report none.
    try { $s.dayLimit = [int](@($resp.Headers.GetValues('x-ratelimit-limit-requests'))[0]) } catch {}
    try { $s.dayLeft = [int](@($resp.Headers.GetValues('x-ratelimit-remaining-requests'))[0]) } catch {}
    # Read the stream in chunks: one SSE line per async read is far too slow in PowerShell.
    $s.reader = $resp.Content.ReadAsStreamAsync().Result
    $s.decoder = $utf8.GetDecoder()
    $s.carry = ''
    $s.phase = 'waiting'
    $s.last = $now
    $s.dirty = $true
  }
  for ($n = 0; $n -lt 50; $n++) {
    if ($null -eq $s.line) { $s.line = $s.reader.ReadAsync($s.buf, 0, $s.buf.Length) }
    if (-not $s.line.IsCompleted) { break }
    if ($s.line.IsFaulted) { Fail-Candidate $s (Hide-Keys $s.line.Exception.GetBaseException().Message); return }
    $got = $s.line.Result
    $s.line = $null
    if ($got -le 0) { Finish-Slot $s; return }
    $nc = $s.decoder.GetChars($s.buf, 0, $got, $s.cbuf, 0)
    $parts = ($s.carry + [string]::new($s.cbuf, 0, $nc)).Split("`n")
    $s.carry = $parts[$parts.Length - 1]
    for ($i = 0; $i -lt $parts.Length - 1; $i++) {
      $l = $parts[$i].Trim()
      if ($l -eq 'data: [DONE]') { Finish-Slot $s; return }
      if (-not $l.StartsWith('data:')) { continue }
      try { $o = $jss.DeserializeObject($l.Substring(5).Trim()) } catch { continue }
      if ($o -isnot [System.Collections.IDictionary]) { continue }
      $s.last = [DateTime]::UtcNow
      $s.dirty = $true
      if ($o.ContainsKey('error') -and $o['error']) {
        $e = $o['error']
        $m = [string]$e
        if ($e -is [System.Collections.IDictionary] -and $e.ContainsKey('message')) { $m = [string]$e['message'] }
        Fail-Candidate $s (Hide-Keys $m)
        return
      }
      # Token usage arrives in the last chunk (Groq also nests it under x_groq).
      $groq = $null
      if ($o['x_groq'] -is [System.Collections.IDictionary]) { $groq = $o['x_groq']['usage'] }
      foreach ($u in @($o['usage'], $groq)) {
        if ($u -is [System.Collections.IDictionary] -and $u.ContainsKey('total_tokens')) { $s.tokens = [int]$u['total_tokens'] }
      }
      if (-not $o.ContainsKey('choices') -or -not $o['choices'] -or $o['choices'].Count -eq 0) { continue }
      $delta = $o['choices'][0]['delta']
      if ($delta -isnot [System.Collections.IDictionary]) { continue }
      $r = $null
      if ($delta.ContainsKey('reasoning_content')) { $r = $delta['reasoning_content'] }
      if (-not $r -and $delta.ContainsKey('reasoning')) { $r = $delta['reasoning'] }
      if ($r) {
        $s.reasoning += ([string]$r).Length
        if ($s.phase -ne 'writing') { $s.phase = 'thinking' }
      }
      if ($delta.ContainsKey('content') -and $delta['content']) {
        [void]$s.text.Append([string]$delta['content'])
        $s.phase = 'writing'
      }
    }
  }
  if (($s.dirty -or ([DateTime]::UtcNow - $s.written).TotalSeconds -ge 5) -and ([DateTime]::UtcNow - $s.written).TotalMilliseconds -ge 1000) {
    Write-SlotStatus $s
  }
}

# ---------- fact check ----------

$facts = $null
if ($spec.facts) {
  $facts = [pscustomobject]@{
    cfg = $spec.facts; phase = 'extracting'; note = ''; claims = @(); idx = 0; results = @()
    extractors = @($spec.facts.extractors); eIdx = 0; send = $null; started = [DateTime]::UtcNow
    runStart = [DateTime]::UtcNow; research = ''; researchId = ''; nextPoll = [DateTime]::MinValue; tavily = $null
  }
}

function Write-Facts {
  $o = [ordered]@{
    phase = $facts.phase; claims = $facts.claims.Count; searched = $facts.results.Count; note = $facts.note
    seconds = [int]([DateTime]::UtcNow - $facts.runStart).TotalSeconds
  }
  Write-Json ([string]$facts.cfg.statusFile) $o
}

function Finish-Facts([string]$phase, [string]$note) {
  $facts.phase = $phase
  if ($note) { $facts.note = $note }
  $out = [ordered]@{ claims = @($facts.results); research = $facts.research; note = $facts.note }
  Write-Json ([string]$facts.cfg.outFile) $out
  Write-Facts
}

$EXTRACT_RULES = @"
List up to {N} factual claims in this plan that can be checked on the web: library or package versions, API names and behaviour, model IDs, service limits and quotas, prices, CLI flags, dates. Skip opinions, plans and facts about the user's own code.
Reply with JSON only, no prose, no code fence:
{"claims":[{"claim":"one sentence stating the fact","quote":"the exact words from the plan","query":"a web search query that would confirm or refute it"}]}
If there are none, reply {"claims":[]}.
"@

function Start-Extract {
  while ($facts.eIdx -lt $facts.extractors.Count) {
    $c = $facts.extractors[$facts.eIdx]
    $facts.eIdx++
    if (Get-Off ([string]$c.keyEnv) ([string]$c.model)) { continue }
    $key = Get-Key ([string]$c.keyEnv)
    if (-not $key) { continue }
    $text = $plan
    if ($text.Length -gt [int]$c.planCap) { $text = $text.Substring(0, [int]$c.planCap) }
    $body = [ordered]@{ model = [string]$c.model; stream = $false }
    if ($c.params) { foreach ($p in $c.params.PSObject.Properties) { $body[$p.Name] = $p.Value } }
    $body.messages = @(
      [ordered]@{ role = 'system'; content = $EXTRACT_RULES.Replace('{N}', [string]$facts.cfg.maxClaims) },
      [ordered]@{ role = 'user'; content = $text }
    )
    $facts.send = $client.SendAsync((New-Request 'POST' ([string]$c.url) $key ($body | ConvertTo-Json -Depth 8 -Compress)))
    $facts.started = [DateTime]::UtcNow
    return
  }
  Finish-Facts 'skipped' 'fact check skipped: no model could list the claims'
}

# Free only: reads Tavily's usage (free) and decides whether this run may search.
function Test-Tavily([int]$needed) {
  $key = Get-Key 'TAVILY_API_KEY'
  if (-not $key) { return 'no Tavily key' }
  try { $u = Get-JsonNow 'https://api.tavily.com/usage' $key } catch { return "could not check Tavily usage ($(Hide-Keys $_.Exception.Message))" }
  $a = $u.account
  if ([double]$a.paygo_usage -gt 0) { return 'pay-as-you-go usage appeared; free credits only' }
  if (-not $a.plan_limit) { return "plan '$($a.current_plan)' has no fixed credit limit; free credits only" }
  if ([double]$a.plan_usage + $needed -ge [double]$a.plan_limit) { return "$($a.plan_usage) of $($a.plan_limit) free Tavily credits used this month" }
  return ''
}

function Start-Search {
  if ($facts.idx -ge $facts.claims.Count) { Start-Research; return }
  $cl = $facts.claims[$facts.idx]
  $body = [ordered]@{ query = [string]$cl.query; search_depth = [string]$facts.cfg.searchDepth; max_results = [int]$facts.cfg.resultsPerClaim; include_answer = $false }
  $facts.send = $client.SendAsync((New-Request 'POST' 'https://api.tavily.com/search' (Get-Key 'TAVILY_API_KEY') ($body | ConvertTo-Json -Compress)))
  $facts.started = [DateTime]::UtcNow
}

function Start-Research {
  $mode = [string]$facts.cfg.research
  if ($mode -ne 'mini' -and $mode -ne 'pro') { Finish-Facts 'done' ''; return }
  $reserve = 110
  if ($mode -eq 'pro') { $reserve = 250 }
  $why = Test-Tavily $reserve
  if ($why) { Finish-Facts 'done' "research skipped: $why"; return }
  $text = $plan
  if ($text.Length -gt 6000) { $text = $text.Substring(0, 6000) }
  $body = [ordered]@{ input = "Check whether the technical choices in this implementation plan are current and correct, and what the best current alternatives are:`n$text"; model = $mode }
  $facts.send = $client.SendAsync((New-Request 'POST' 'https://api.tavily.com/research' (Get-Key 'TAVILY_API_KEY') ($body | ConvertTo-Json -Compress)))
  $facts.phase = 'researching'
  $facts.started = [DateTime]::UtcNow
}

function Read-Done($t) {
  # Returns @(code, body) for a finished HTTP task, or throws its error.
  if ($t.IsFaulted) { throw $t.Exception.GetBaseException().Message }
  $resp = $t.Result
  return @([int]$resp.StatusCode, $resp.Content.ReadAsStringAsync().Result)
}

function Step-Facts {
  if ($facts.phase -in 'done', 'skipped', 'failed') { return }
  $age = ([DateTime]::UtcNow - $facts.started).TotalSeconds
  if ($facts.phase -eq 'extracting' -and $age -gt 120) { $facts.send = $null; Start-Extract; return }
  if ($facts.phase -eq 'searching' -and $age -gt 60) {
    $cl = $facts.claims[$facts.idx]
    $facts.results += [ordered]@{ claim = [string]$cl.claim; quote = [string]$cl.quote; query = [string]$cl.query; sources = @(); error = 'search timed out' }
    $facts.idx++; $facts.send = $null; Write-Facts; Start-Search; return
  }
  if ($facts.phase -eq 'researching' -and $age -gt 600) { $facts.send = $null; Finish-Facts 'done' 'research timed out'; return }
  if ($facts.phase -eq 'researching' -and $facts.researchId -and -not $facts.send) {
    if ([DateTime]::UtcNow -lt $facts.nextPoll) { return }
    $facts.send = $client.SendAsync((New-Request 'GET' "https://api.tavily.com/research/$($facts.researchId)" (Get-Key 'TAVILY_API_KEY') $null))
    return
  }
  if (-not $facts.send -or -not $facts.send.IsCompleted) { return }
  try { $r = Read-Done $facts.send } catch { $r = @(0, (Hide-Keys "$_")) }
  $facts.send = $null
  $code = $r[0]; $raw = $r[1]
  if ($facts.phase -eq 'extracting') {
    $list = @()
    if ($code -eq 200) {
      try {
        $content = [string](($raw | ConvertFrom-Json).choices[0].message.content)
        # No JSON (an empty reply from a model that spent its budget thinking) is a
        # failure, so the next extractor gets a turn instead of "no claims".
        $a = $content.IndexOf('{'); $b = $content.LastIndexOf('}')
        if ($a -ge 0 -and $b -gt $a) { $list = @(($content.Substring($a, $b - $a + 1) | ConvertFrom-Json).claims) } else { $list = $null }
      } catch { $list = $null }
    } else { $list = $null }
    if ($null -eq $list) { Start-Extract; return }
    $list = @($list | Where-Object { $_.claim -and $_.query } | Select-Object -First ([int]$facts.cfg.maxClaims))
    if ($list.Count -eq 0) { Finish-Facts 'done' 'no checkable claims in the plan'; return }
    $credits = $list.Count * 2
    $why = Test-Tavily ($credits + 50)
    if ($why) { $facts.claims = $list; Finish-Facts 'skipped' "fact check skipped: $why"; return }
    $facts.claims = $list
    $facts.phase = 'searching'
    Write-Facts
    Start-Search
    return
  }
  if ($facts.phase -eq 'searching') {
    $cl = $facts.claims[$facts.idx]
    $found = @()
    if ($code -eq 200) {
      try {
        foreach ($x in @(($raw | ConvertFrom-Json).results)) {
          $snip = [string]$x.content
          if ($snip.Length -gt 500) { $snip = $snip.Substring(0, 500) }
          $found += [ordered]@{ title = [string]$x.title; url = [string]$x.url; snippet = ($snip -replace '\s+', ' ') }
        }
      } catch {}
    }
    $facts.results += [ordered]@{ claim = [string]$cl.claim; quote = [string]$cl.quote; query = [string]$cl.query; sources = @($found); error = $(if ($code -eq 200) { '' } else { "search failed (HTTP $code)" }) }
    $facts.idx++
    Write-Facts
    Start-Search
    return
  }
  if ($facts.phase -eq 'researching') {
    if ($code -lt 200 -or $code -ge 300) { Finish-Facts 'done' "research failed (HTTP $code)"; return }
    $o = $raw | ConvertFrom-Json
    if (-not $facts.researchId) { $facts.researchId = [string]$o.request_id }
    if ($o.status -eq 'completed') {
      $content = $o.content
      if ($content -isnot [string]) { $content = $content | ConvertTo-Json -Depth 6 -Compress }
      if ($content.Length -gt 8000) { $content = $content.Substring(0, 8000) }
      $facts.research = $content
      Finish-Facts 'done' ''
      return
    }
    if ($o.status -eq 'failed') { Finish-Facts 'done' 'research failed'; return }
    $facts.nextPoll = [DateTime]::UtcNow.AddSeconds(5)
  }
}

if ($facts) { Write-Facts; Start-Extract }

# ---------- main loop ----------

while ($true) {
  if (Test-Path -LiteralPath $spec.cancelFile) {
    foreach ($s in $slots) {
      if ($s.phase -notin 'done', 'failed') { Close-Stream $s; $s.phase = 'failed'; $s.error = 'cancelled'; Write-SlotStatus $s }
    }
    if ($facts -and $facts.phase -notin 'done', 'skipped', 'failed') { Finish-Facts 'failed' 'cancelled' }
    break
  }
  $active = $false
  foreach ($s in $slots) {
    if ($s.phase -in 'done', 'failed') { continue }
    $active = $true
    Step-Slot $s
  }
  if ($facts -and $facts.phase -notin 'done', 'skipped', 'failed') { $active = $true; Step-Facts }
  if (-not $active) { break }
  # Wake as soon as any pending read or request finishes: a fixed sleep capped the
  # stream at a few events a second (GPT-OSS took 183 s instead of seconds).
  # A task that already finished counts too: WaitAny then returns at once, so the
  # loop never sleeps while a read is ready (that sleep cost 100 ms per event).
  $pending = New-Object System.Collections.Generic.List[System.Threading.Tasks.Task]
  foreach ($s in $slots) {
    if ($s.phase -in 'done', 'failed') { continue }
    if ($s.line) { $pending.Add($s.line) }
    elseif ($s.send -and -not $s.reader) { $pending.Add($s.send) }
  }
  if ($facts -and $facts.send) { $pending.Add($facts.send) }
  if ($pending.Count -gt 0) { [void][System.Threading.Tasks.Task]::WaitAny($pending.ToArray(), 250) }
  else { Start-Sleep -Milliseconds 100 }
}

[IO.File]::WriteAllText([string]$spec.doneFile, 'done', $utf8)
