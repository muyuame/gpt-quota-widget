# GPT 额度挂件 · Codex 本地插件

这是当前 GPT 额度挂件的 Codex 插件入口，适配此电脑上的 Windows / Node.js 环境。

安装后新建一个 Codex 聊天，可以直接说：

- “启动 GPT 额度挂件”
- “查看我剩余的 Codex 额度”
- “把 GPT 挂件切换为独立桌面模式”
- “关闭 GPT 额度挂件”

插件包含一个调用说明技能和四个本地 MCP 工具，管理现有透明桌面挂件。人物窗口继续由 Electron 和 Windows 跟随监控显示，插件不会把人物直接嵌进聊天区。既有 GPT 图片、字体颜色、随机语句、缓存额度、每轮消耗提示及个人设置均继续使用。

本地挂件位于相邻的 `../codex-quota-widget` 目录。插件包只包含工具和说明，不复制登录信息、个人数据或 Electron。移动或克隆后，保持挂件目录和插件源码目录相邻，运行“安装插件.cmd”即可生成当前电脑的配置并安装。

如果安装时提示缺少 `desktop`，说明只拿到了插件入口或工程不完整。请从[私有仓库根目录](https://github.com/muyuame/gpt-quota-widget)克隆整个工程；`codex-quota-widget/desktop/` 与本目录应当位于同一级。不要用旧版挂件目录覆盖新版源码。

## 安装与更新

在此目录运行 `安装插件.cmd`，或在 PowerShell 运行：

```powershell
codex plugin marketplace add <本仓库路径>\gpt-quota-plugin-source
codex plugin add gpt-quota-widget@gpt-quota-local
```

更新插件源代码后再次运行 `安装插件.cmd`；新建聊天加载新版本。插件列表中显示为“GPT 额度挂件”。

## 关闭与卸载

“关闭挂件”停止窗口及监控；不改变开机自启设置。插件启用时不会自行弹出人物，首次说“启动 GPT 额度挂件”即可。若以前已启用开机自启，该设置仍独立生效。

卸载插件可在 Codex 插件列表中操作，或运行 `codex plugin remove gpt-quota-widget@gpt-quota-local`。卸载只移除 Codex 的插件入口，不删除现有挂件、图片或个人设置；卸载前需要关窗口时先说“关闭 GPT 额度挂件”。

## 检查

```powershell
node --test plugins/gpt-quota-widget/tests/mcp.test.mjs
codex plugin list --json --marketplace gpt-quota-local
```

额度来自当前 Codex 登录账号的官方只读接口。缺失时明确报告不可用，旧缓存会标记 stale，不将 token 数或单次回复推算为额度百分比。

挂件源项目与版权说明见现有挂件的 LICENSE、PROVENANCE.md 和 THIRD_PARTY_NOTICES.md；本插件沿用 MIT 许可，人物图片为用户提供。
