# 较真 · 再改一版

两个可独立运行的 DeepSeek Harness 社区插件。**较真**帮写研究摘要的人核对数字。**再改一版**帮使用 Agent 的团队看清，哪些任务最终交付了，却在第一次提交后经历了返工。

## 较真

假设一份经营摘要把收入增长率写成 25%。示例原表记录了两期收入，分别为 100 万元和 120 万元。较真统一单位、重算出 20%，并关闭整份交付。修正数字后，它才生成可交付正文。这份收入案例使用合成数据。

真实数据演示从世界银行 WDI 接口取得中国 2024 年人口发布值，按国家、年份、指标和单位核验。报告保留重算结果、发布更新时间和响应指纹。专用严格模式由 Harness 输出经过核验的文本。当前官方数据入口支持 WDI 人口指标，本地结构化原表另有核验入口。

[官方数据报告截图](artifacts/authority-1440.png) · [错误拦截截图](artifacts/evidence-ledger-1440.png) · [严格模式实测记录](artifacts/protected-live.json) · [插件说明](evidence-ledger/README.md)

## 再改一版

同一批有完整标注的三个示例任务中，首次通过一个，最终完成两个。展开任务可以查看纠正记录，缺失证据单独计为未知。示例为合成数据，分析自己的任务时可替换成带依据的标注。

[任务复盘截图](artifacts/task-lens-1440.png) · [插件说明](task-lens/README.md)

## 在 DSH 插件市场找到这两个插件

在「插件」的实验功能中启用 **Custom plugin indexes（自定义插件索引）**，进入 **Discover（发现）**，点击 **Add index source（添加索引源）**，粘贴下面的地址。这是本项目维护的公开索引。

~~~text
https://raw.githubusercontent.com/Singapo/deepseek-harness-plugins/main/index.json
~~~

选择这个索引后，搜索「较真」或「再改一版」，打开卡片查看版本和安装来源。两张卡片分别安装对应的插件，兼容范围为已验证的 DSH 0.2.1-rc.2。安装「较真」后默认为普通核验工具，严格模式按子项目说明单独启用。

## 本地体验

从仓库根目录运行以下命令。需要 Node.js 22 或更新版本，两个离线演示均无需安装依赖或配置 API Key。

~~~sh
npm --prefix evidence-ledger run demo
npm --prefix task-lens run demo
~~~

分别打开 evidence-ledger/output/demo/report.html 和 task-lens/output/demo/report.html 即可查看报告。以下命令重新向世界银行取数，需联网。

~~~sh
npm --prefix evidence-ledger run demo:authority
~~~

## 验证

~~~sh
npm --prefix evidence-ledger test
npm --prefix task-lens test
~~~

已验证的 Harness SDK 版本为 0.2.1-rc.2。参考 [Dayu Agent](https://github.com/noho/dayu-agent) 的统一取数和审计思路。两个插件分别附有 MIT 许可证。
