# 较真

**数据没核清，先别交。**

较真在 AI 提交数据结论前，从官方接口取数、核对口径、重算数字。任一数字错误、数据缺失或来源异常，整份交付正文保持关闭。专用严格模式接管 Harness 的流式回复，只输出代码核验后的正文，拒绝模型补写和工具绕过。

主要参考 [大愚 Agent](https://github.com/noho/dayu-agent) 的宿主约束、统一数据入口和审计流程，先完成一个小而可复现的数据核验闭环。原有的引用检查保留为辅助功能。

个人作品 / MVP，版本 0.3.0。Node.js 22+；独立运行无第三方依赖、无 API Key。官方取数需要联网；本地原表演示可离线运行。不是 DeepSeek 或 Dayu 官方产品。

## 一分钟体验

在本项目目录执行：

```powershell
# 真实公开数据：直连世界银行官方 API，核验中国 2024 年人口发布值
npm run demo:authority
Start-Process output/authority/report.html

# 全部正确：退出码 0，生成可交付正文
npm run demo
Start-Process output/demo/report.html

# 故意混入错误：退出码 2，生成拦截报告
npm run demo:blocked
Start-Process output/blocked/report.html
```

`demo:authority` 使用真实官方数据，发布值修订后示例中的旧数字会被拦截。其余收入示例为合成数据：2023 年收入 1000000 元，2024 年收入 120 万元。拟交付增长率写成 25% 时，工具先统一单位、重算出 20%，再拦截这条结论。错公司、错期间和不支持的预测也不会被放行。

每次生成 `report.html`、`report.json`、`verified.md`。未全部通过时 `gate.verifiedText=null`，`verified.md` 只有阻断提示。重新核验先使上次的交付正文失效，输入缺失、非法 JSON、文件变化均不会继续保留上次的通过正文。同一输出目录用文件锁避免并发写入。

## 这条流程检查什么

1. **可信入口**：官方模式由代码固定 HTTPS 域名、指标映射与时效规则，不接受模型传入网页正文、URL 或基准指纹。保留原始响应字节、发布时间、取数时间与 SHA-256。本地模式仍要求用户确认原表并固定指纹。
2. **精确选行**：对象、期间、指标、单位逐项匹配，保留原始行号和文件指纹；不做模糊匹配或缺失值补全。
3. **核对数据**：检查字段、十进制数、单位、已披露/估计标注；同口径在已载入来源中数值冲突时，不允许只挑一份通过。
4. **重算结果**：当前支持原值核对与两期变动率。金额换算与计算使用整数分数，按声明的小数位四舍五入，不使用二进制浮点近似。
5. **决定交付**：所有结论和所有选定来源均通过，才从已核验字段生成正文。没有忽略错误或强制放行选项。

## 输入契约

完整可运行输入见 `examples/check.json` 和 `examples/check-pass.json`。

请求文件 `schemaVersion:2` 包含：

| 字段 | 含义 |
|---|---|
| `sources[]` | 官方：`{id,title,provider:"worldbank",country:"CHN",from:2024,to:2024}`；本地：`{id,title,path,sha256}` |
| `claims[].id` | 唯一 ID |
| `entity / period / metric / unit` | 拟交付的对象、期间、指标、单位 |
| `operation` | `value` 原值，或 `growth` 两期变动率 |
| `reportedValue` | 拟交付的十进制数字，必须是字符串；不接受科学计数法或浮点 JSON 数字 |
| `decimals` | 结果小数位，0–6；拟交付数值须与该精度下的重算值相等 |
| `inputs[]` | `{sourceId,entity,period,metric,unit}`；原值一条，变动率按基期、本期顺序两条 |

每份原表是独立 JSON 文件：`{schemaVersion:1, rows:[{entity,period,metric,unit,value,basis}]}`。`value` 为十进制字符串，`basis` 为 `reported` 或 `estimate`；估计值不能以已披露事实交付。期间支持 `YYYY`、`YYYY-Q1…Q4`、`YYYY-H1…H2`，两期计算须为同类期间且基期在前。输出使用“两期变动率”，不会自动称作同比或环比。

支持元/万元/亿元、美元/万美元/亿美元、人/万人、百分比。不同货币不换汇。变动率的基期为零或负数时保留待核验。每个输入文件最多 2 MiB，每份原表最多 10000 行、20 份原表、1000 条结论。

本地原始文件只读、不遍历目录。原表路径及符号链接解析后的真实路径必须在请求目录内，越界会阻断。输出目录需与输入目录分离。

官方适配器当前仅支持世界银行 WDI 人口指标 `SP.POP.TOTL`，固定映射为“人口总数（世界银行发布值）”。每次实时取数，不使用成功缓存兜底。检查 HTTPS 原域名、禁止重定向、响应上限 2 MiB、15 秒超时、国家和指标身份、完整分页、期间完整性、唯一整数值与发布更新时间。发布时间超过 365 天或明显在未来会阻断；一次请求最多覆盖连续 5 年。世界银行 API 文档见[请求结构](https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures)。

```powershell
# 确认来源与内容后，手工将此指纹写入请求 sources[].sha256
Get-FileHash examples/data/disclosure.json -Algorithm SHA256
node bin/verify.js examples/check-pass.json --out output/my-check
```

退出码：`0` 放行，`2` 核验完成但拦截，`1` 请求、文件或执行失败。进程崩溃可能留下 `.jiaozhen.lock`；确认没有核验进程运行后再删除该锁。

## 在 DeepSeek Harness 使用

```powershell
dsh plugin --profile web add .
```

也可在插件管理器添加此目录的绝对路径。启用后调用 `jiaozhen_verify_data`，参数 `requestPath` 是用户明确授权的请求文件绝对路径。工具自己读取原始文件，返回核验报告；仅在放行时返回 `gate.verifiedText`，工具入口不写文件。

给 Agent 的示例指令：

> 用 jiaozhen_verify_data 核验我指定的请求文件。不得自行重写原始数据或更新指纹。若 gate.status 不是 passed，报告阻断原因；通过后仅使用 gate.verifiedText 中的数据正文，不添加未经核验的数字或判断。

普通工具模式适合诊断，不约束模型的其他回复。需要阻止绕过时，启用下面的专用模式。

## 严格模式：宿主直接交付

```powershell
# 安装到单独的数据核验 profile
dsh plugin --profile jiaozhen add .
# 先把补丁中的 requestPath 改成 check-authority.json 的实际绝对路径
dsh --profile jiaozhen --patch examples/protected.patch.yml
```

补丁加载 `dsh-evidence-ledger/protected`。所有普通回复都核验宿主配置的同一请求；这是固定任务的数据交付模式。需要换任务时由用户改配置，不通过聊天指令换来源。

在官方 `llm/stream` 扩展点直接执行核验，不调用后续模型适配器。通过则输出确定性正文及官方取数记录；失败只输出停止交付提示。`tools.guard` 拒绝本 profile 的所有工具调用，避免改写原始请求或另写一份未经核验的文件。每轮重新读请求、重新取官方数据，没有沿用上次通过结果的路径。本地快照在严格模式中一律拒绝。

不要把补丁加到日常通用助手 profile：它会接管该 profile 的全部 LLM 回复并禁用工具。用户停用插件后，约束随之移除。其他插件和宿主自身属于可信配置边界，此实现不防管理员修改代码或安装篡改输出的插件。

已在本机 **DSH / SDK 0.2.1-rc.2** 的真实 Cordis、ToolRuntime、LlmRuntime 验证，也已将实时官方响应通过严格流式入口交付；未验证最新 master。复现脚本及结果见集合根目录 `scripts/verify-protection.mjs`、`artifacts/protection-validation.json`、`artifacts/protected-live.json`。本轮付费模型调用为 0。

## 怎样理解“杜绝幻觉”

产品目标是让数据错误在交付前被挡住。当前做到：**固定官方数据入口、确定性重算和宿主交付接管，未经核验的模型文本无法从启用严格插件的这条流式入口输出。**

这保证的是按官方发布值和明确规则交付，不保证发布方对现实世界的测量永无误差。目前没有通用 PDF/OCR 财报抽取、任意指标的可信映射或自由文字语义真伪判断。不支持的任务不进入严格交付。

本地模式仍可能以错误原表为基准；普通工具模式也不接管会话。因此演示与面试时应明确指出启用了哪种模式，不能把单一适配器的结果推广为全场景零幻觉。

## 辅助：引用检查

```powershell
npm run demo:citations
```

原 `evidence_ledger_audit` 接口继续支持 `examples/brief.json` 的 schemaVersion:1：逐字引句匹配、来源关联、矛盾标注审计。该结果**不进入数据放行流程**，原文包含某句话不等于这句话为真或足以支持结论。

## 验证与发布

```powershell
npm test
npm pack --dry-run --ignore-scripts
```

数据流程测试覆盖错误数值、对象与期间错配、单位换算、十进制舍入、来源变化、冲突、估计值、零/负基期、文件边界、旧正文失效和并发锁。报告可离线搜索、筛选和导出 JSON。真实用户试用与外部事实真值集尚未完成。

MIT License。保留内部包名 `dsh-evidence-ledger` 和目录名以兼容原引用；展示名为较真。设计参考 Dayu，没有复制其源码或宣称官方关联。
