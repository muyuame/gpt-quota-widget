# GPT 额度挂件

本仓库包含相邻的两部分：`codex-quota-widget/` 是桌面挂件程序，`gpt-quota-plugin-source/` 是 Codex 本地插件入口。安装与使用说明分别见这两个目录中的 README。

请克隆**整个仓库**，不要只下载 `gpt-quota-plugin-source/` 子目录。气泡界面和桌面运行代码位于 `codex-quota-widget/desktop/`，插件入口会调用同一仓库中的挂件程序。

```powershell
git clone https://github.com/muyuame/gpt-quota-widget.git
cd gpt-quota-widget
.\gpt-quota-plugin-source\安装插件.cmd
```

安装脚本会根据当前电脑的位置生成插件的 MCP 配置。首次启动挂件时会在 `codex-quota-widget/data/` 安装 Electron；需要 Node.js 24+、npm 和已登录的 Codex CLI。

`codex-quota-widget/data/` 保存个人设置、账号相关缓存、Electron 运行环境和日志，不纳入版本控制。克隆到新电脑后需重新准备 Node.js、Electron 和 Codex 登录环境。项目素材及上游版权说明见 `codex-quota-widget/PROVENANCE.md`、`LICENSE` 和 `THIRD_PARTY_NOTICES.md`。
