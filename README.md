# TokenTempo · 词速表

A small, read-only terminal monitor for **estimated reply-generation speed** in local ChatGPT Work and Codex sessions. Windows-first, offline, zero npm dependencies.

**正文速度有据可查。** 显示每次回复的正文速度估算、非推理输出 token、正文时段、整轮 TTFT 和最近趋势。不会把输入 token 或按秒落盘的用量尖峰冒充生成速度。

## Windows：解压，双击

1. 在 [Releases](https://github.com/cb8010d6/TokenTempo/releases) 下载 `TokenTempo-*-windows-x64.zip`。
2. **解压整个压缩包**，保留 `src`、`runtime` 等目录。
3. 双击 **`Start-TokenTempo.cmd`**。便携包内置 Node.js，无需安装依赖、配置 API Key 或修改 Codex。
4. 保持窗口打开，在 Work / Codex 完成一次回复。速度在完整记录落盘后更新。

源码 ZIP 不包含运行环境；使用源码需要 Node.js 22 或更新版本。

```sh
node src/cli.mjs
node src/cli.mjs --demo
node src/cli.mjs --once
```

| 按键 | 操作 |
| --- | --- |
| ← / → / Tab | 切换并固定会话 |
| A | 自动跟随最近活动的会话 |
| F | 切换最终回复 / 所有文本回复 |
| D | 显示统计口径 |
| R | 重新扫描 |
| Q / Esc / Ctrl+C | 退出 |

窗口至少需要 76 列 × 24 行。自动跟随依据**日志活动**，不读取桌面焦点。会话以模型名和 ID 后缀区分，不展示聊天标题或内容。

## What the number actually means

```text
estimated text TPS = (response output tokens - response reasoning tokens)
                     / completed text-message duration in seconds
```

The monitor only accepts a response window when:

- There is exactly one assistant text message and one matching `AgentMessage` completion.
- The raw message ID, completion ID, thread and turn match.
- Per-response `token_usage_record.usage` contains valid output and reasoning counters.
- No tool call, image generation, or unrecognized model output shares that usage window.
- The message has valid `started_at_ms` / `completed_at_ms` timing lasting at least 250 ms.

This is **an estimate, not server-side decoder TPS or a live token-arrival meter**. The message lifecycle can include buffering / client overhead, and non-reasoning output counters can include protocol overhead. It is not necessarily comparable to a vendor's decoder benchmark. No arbitrary upper clamp is applied: genuinely high rates remain visible if the records meet the rules.

**Missing data is `—`, never a made-up zero.** Ambiguous or unsupported replies remain in the table with a reason. Mixed text/tool responses are deliberately excluded; their non-reasoning tokens include tool-call arguments. No character-to-token heuristic is used.

`TTFT` and total duration come from `task_complete.time_to_first_token_ms` and `duration_ms`. These are **turn-level client values**, not the displayed message's TTFT. A turn can include reasoning and multiple model/tool calls. Until the turn completes these fields can be missing. The last valid speed is retained during activity and is labeled as a previous completed sample.

## Coverage and privacy

- Reads `sessions/` beneath `CODEX_HOME`, or the current user's default Codex home. `--codex-home` overrides it.
- Scans metadata to select the 24 most recently modified local rollouts; `--limit` allows 1–100. Content is read incrementally, and discovery refreshes every 10 seconds.
- Skips files larger than 64 MiB at initial load and malformed / oversized lines. Interrupted final lines are held until complete. Older rollouts without matching per-response counters and message timing do not produce speed estimates.
- Cloud-only sessions, remote computers, archived sessions, and unpersisted traffic are outside the default coverage. A local Work session can be measured when it writes the supported records; this is not a promise that every Work backend does so.
- Reads **no auth files**, starts **no API calls**, changes **no Codex config**, and opens **no network listener**. TUI mode has no network requests, price fetching, tracking, or automatic updates.
- JSON is parsed in memory. Prompt text, assistant text and tool arguments are discarded rather than retained by the metrics model. Only numeric metrics, IDs and model names are displayed/exported. `--json` output is local data; review it before sharing.
- No actual conversations, account details, local measurements or machine-specific paths are included in this repository. The demo and tests are synthetic.

The rollout format is internal and may change. Unsupported data is omitted or marked unavailable rather than inferred from unrelated counters. The format was tested against locally persisted desktop records in October 2026; compatibility is defined by fields, not a blanket app-version claim.

## Options

```sh
node src/cli.mjs --help
node src/cli.mjs --codex-home "<codex-home>"
node src/cli.mjs --file "<session-rollout.jsonl>"
node src/cli.mjs --session "<session-id>"
node src/cli.mjs --limit 40 --interval 2000
node src/cli.mjs --json > metrics.json
```

`--json` is a one-shot numeric snapshot. `--once` renders one text screen. There is no background daemon or startup task. Close the terminal or press Q to stop.

## Development

```sh
npm test
npm run check
```

Node's built-in test runner covers token accounting, record correlation, duplicate usage, mixed tools, incomplete logs, truncation, missing metrics and terminal layout. Tests use synthetic input only and never read your Codex home.

Windows portable packaging (PowerShell, Node.js installed):

```powershell
./scripts/package-windows.ps1
```

The packaging script copies the local x64 Windows Node executable and fetches that exact version's redistribution license from the official Node.js repository. The application itself remains offline. The release includes source, the runtime and licenses; no local session data is packaged. GitHub Actions repeats tests on Windows and Linux and builds the Windows portable ZIP.

## References

- [Official Codex App Server events](https://learn.chatgpt.com/docs/app-server): message lifecycle, delta events and usage notifications. These public events explain the distinction; they do **not** guarantee the private on-disk schema used here.
- [Official advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced): client telemetry and turn-level TTFT.
- [codex-tps](https://github.com/adenta/codex-tps): an alternative for effective per-response throughput reports, with a different timing denominator.
- [llmstat](https://github.com/lexoliu/llmstat): broader usage monitoring; its rolling usage rate is not this tool's message-duration estimate.

MIT licensed. Independent community project, not affiliated with or endorsed by OpenAI.
