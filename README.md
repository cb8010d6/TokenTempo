# TokenTempo · 词速表

A small, read-only terminal monitor for **estimated reply-generation speed** in local ChatGPT Work and Codex sessions. Windows-first, offline, zero npm dependencies.

**正文速度有据可查。** 显示每次回复的正文速度估算、非推理输出 token、正文时段、整轮 TTFT 和最近趋势。不会把输入 token 或按秒落盘的用量尖峰冒充生成速度。

顶部显示**最新一次模型输出**的非推理、总输出和推理 token；非推理计数包含正文与工具调用参数。混合输出、纯工具调用也显示计数。默认列表为所有模型输出，按 **F** 切到最终回复。历史正文速度单独标明时间；混合输出缺少完整生成时段时只显示计数，不借用正文时段计算速度。按 **D** 可查看统计口径及历史正文／整轮用时。

## Windows：解压，双击

1. 在 [Releases](https://github.com/cb8010d6/TokenTempo/releases) 下载 `TokenTempo-*-windows-x64.zip`。
2. **解压整个压缩包**，保留 `src`、`runtime` 等目录。
3. 双击 **`Start-TokenTempo.cmd`**。便携包内置 Node.js，无需安装依赖、配置 API Key 或修改 Codex。
4. 保持窗口打开，在 Work / Codex 完成一次回复。速度在完整记录落盘后更新。

双击时优先在 **Windows Terminal** 打开中文版。旧版 Windows 控制台可能缺少中文字形；没有现代终端时自动使用 **English / ASCII** 兼容界面，不修改系统字体或注册表。按 **L** 随时切换语言，也可使用 `--lang en` / `--lang zh`。若要强制留在当前控制台，可设置 `TOKEN_TEMPO_NO_WT=1`。

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
| F | 切换最终回复 / 所有模型输出（含工具） |
| D | 显示统计口径 |
| L | 切换中文 / English ASCII |
| R | 重新扫描 |
| Q / Esc / Ctrl+C | 退出 |

窗口至少需要 76 列 × 24 行。自动跟随依据**日志活动**，不读取桌面焦点。会话以模型名和 ID 后缀区分，不展示聊天标题或内容。

默认排除内部子任务（包括 `codex-auto-review` 审核会话），先过滤再选最近会话。需要查看时加 `--include-internal`；显式 `--file` 也允许读取指定的内部会话。

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

**Missing data is `—`, never a made-up zero.** Mixed text/tool and tool-only outputs remain visible with their token counts, but are excluded from text-speed estimates: their non-reasoning tokens include tool-call arguments, and the supported logs do not provide matching full-generation timing. No character-to-token heuristic is used. The top panel always shows the latest counted output, independently of the table's final/all filter; historical text speed is explicitly labeled and timestamped.

In JSON, `outputTokens` is the response's full output counter, `reasoningTokens` is its reasoning component, and `nonReasoningTokens` is their validated difference. Since v0.1.3, `textTokens` is null for mixed/tool or multiple-message output instead of mislabeling inclusive counts as text. `scope` distinguishes text, mixed, and tools/other output. Missing reasoning details leave the total visible while the difference remains unavailable. Tool arguments and conversation content are never exported.

`TTFT` and total duration come from `task_complete.time_to_first_token_ms` and `duration_ms`. These are **turn-level client values**, not the displayed message's TTFT. A turn can include reasoning and multiple model/tool calls. Until the turn completes these fields can be missing. The last valid speed is retained during activity and is labeled as a previous completed sample.

## Coverage and privacy

- Reads `sessions/` beneath `CODEX_HOME`, or the current user's default Codex home. `--codex-home` overrides it.
- Scans metadata to select the 24 most recently modified local rollouts; `--limit` allows 1–100. Content is read incrementally, and discovery refreshes every 10 seconds.
- Large rollouts are read in 256 KiB chunks, without a file-size exclusion. The first scan reads their history and may take several seconds; subsequent refreshes read only appended bytes. Malformed / oversized lines are skipped, and interrupted final lines are held until complete. Older rollouts without matching per-response counters and message timing do not produce speed estimates.
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
node src/cli.mjs --lang en
node src/cli.mjs --include-internal
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
