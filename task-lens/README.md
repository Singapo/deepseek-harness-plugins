# 再改一版

**Agent 最终完成了任务，但第一次交付合用吗？** 再改一版 把首次完成、最终完成、人工纠正和返工恢复放到同一份可追溯报告里。

个人项目 / MVP。支持独立 CLI 和 DeepSeek Harness 工具入口。没有额外模型调用，无数据库，无网络请求。独立 CLI 只需 Node.js 22+，不用安装依赖。

## 一分钟运行

```powershell
node bin/cli.js examples/tasks.json --out output/demo
Start-Process output/demo/report.html
```

生成 `report.html` 与 `report.json`。HTML 可离线搜索、按返工/证据缺失筛选、展开依据并导出 JSON；320px 手机宽度也能阅读。

示例中 4 个任务均为**合成数据**：最终完成 3/4；首次完成 1/3，另 1 条未知。同一批 3 条完整标注任务的最终完成为 2/3、首次为 1/3，避免分母不同造成误读。

## 输入与口径

复制 `examples/tasks.json`，替换为获授权的任务标注。每个可独立验收的目标对应一个 task，纠错和继续仍算同一任务。

| 字段 | 含义 |
|---|---|
| `schemaVersion` | 固定为 1 |
| `tasks[].id / goal / project` | 唯一任务 ID、目标、项目 |
| `model / harness` | 可选，未填记为 unspecified |
| `final / firstPass` | `{value:"pass"或"fail"或"unknown", evidence:[{ref,note}]}` |
| `corrections` | `{value:非负整数或null, evidence:[{ref,note}]}` |

已知结果和纠正次数都要附依据。即使是零次纠正，也要有观察窗口说明；没有依据则按未知处理，并显示提示。未知不进入通过率分母，报告同时显示样本数量与覆盖情况。完整样本的配对通过率单列，不能用不同样本的两个比率推断提升。

一次普通确认不算纠正，用户指出错误或要求返工才算。`firstPass=pass` 与 `final=fail` 在当前“是否完成该目标”的口径下矛盾，拒绝输入；若目标变了，应该另建工作单元。

**边界：** 这是显式标注分析器，不是自动读聊天的裁判。`ref` 是复核指针，工具不会打开、验证或上传它；不把情绪猜测、普通追问当作纠正。不支持模型排名或因果归因。

## 在 Harness 使用

已在本机 **DSH 0.2.1-rc.2** 验证真实 Cordis/ToolRuntime 注册、调用、取消、错误输入和卸载；并通过官方 CLI 在隔离 profile 安装、实际启动及调用工具。当前 master 的兼容性尚未验证。

在此项目目录执行已安装的 CLI：

```powershell
dsh plugin --profile web add .
```

也可在 Harness 的插件管理器添加当前目录的绝对路径。插件启用后提供 `task_lens_analyze`，参数 `dataset` 是上述完整 JSON 对象。它只返回分析结果；需要持久 HTML 报告时运行 CLI。Host 会话可能按其现有设置保存工具参数和结果，提交前检查敏感信息。Harness 主模型调用本身仍按用户配置计费。

可对 Agent 说：

> 读取我明确指定的任务记录，先列出可独立验收的工作单元。没有依据的结果填 unknown、纠正次数填 null。让我核对标注后调用 task_lens_analyze，不要通过语气猜测纠正。

安装包不附带 SDK。`@deepseek-ai/dsh-tools` 为可选 peer，Harness 应提供匹配 SDK；直接在 Harness 外导入 `index.js` 需要安装匹配 peer。CLI 与 `src/core.js` 不依赖它。

## 验证与打包

```powershell
node --test
npm pack --dry-run --ignore-scripts
```

测试覆盖未知值、无依据降级、配对分母、重复任务、矛盾结果、非法计数和 HTML 转义。本仓库不包含历史 35 条评测原始数据，也不把本轮示例当成实际使用效果。

## 为什么做

这个方向来自个人 Agent 协作实践：任务最终成功，仍可能需要人多次指出错误。现有 promptfoo 和 benchmark runner 适合自动化测试；本工具聚焦实际工作单元的交付与人的投入。下一步先验证标注成本和结果是否促成行动，再决定是否做会话导入。

MIT License。个人项目，与 DeepSeek 官方无隶属或背书关系。
