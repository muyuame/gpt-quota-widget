# GPT 额度挂件

本仓库包含相邻的两部分：`codex-quota-widget/` 是桌面挂件程序，`gpt-quota-plugin-source/` 是 Codex 本地插件入口。安装与使用说明分别见这两个目录中的 README。

克隆后保持两个目录相邻，在 Windows 上运行 `gpt-quota-plugin-source/安装插件.cmd` 安装插件。安装脚本会根据当前电脑的位置生成插件的 MCP 配置。

`codex-quota-widget/data/` 保存个人设置、账号相关缓存、Electron 运行环境和日志，不纳入版本控制。克隆到新电脑后需重新准备 Node.js、Electron 和 Codex 登录环境。项目素材及上游版权说明见 `codex-quota-widget/PROVENANCE.md`、`LICENSE` 和 `THIRD_PARTY_NOTICES.md`。
