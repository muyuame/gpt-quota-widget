# GPT 额度挂件 · Codex 桌面伴侣

基于开源桌面挂件底座与 **OpenAI Codex** 原生跟随架构打造的 **GPT 角色桌面额度挂件**及配套 Codex 本地插件，实时展示 ChatGPT 订阅剩余额度与每轮消耗变化。

> ⚠️ **克隆提醒**：请完整克隆**整个仓库**（不要仅下载 `gpt-quota-plugin-source/` 子目录），因为插件入口需要调用相邻 `codex-quota-widget/` 目录中的桌面运行与气泡界面程序。

## 核心特性

- **GPT 角色桌面伴侣**：采用用户提供的 `assets/gpt.avif` / `assets/gpt.png`（保留原始透明通道），完整支持按压回弹、自由拖放、边缘吸附、靠左自动镜像、无级缩放、声音设置、自定义角色导入及位置记忆，支持 `Ctrl+Alt+W` 快捷键或托盘菜单显隐。
- **原版气泡轮廓 + 紫色流光数字**：沿用原版 `1026×700` 思考气泡轮廓与比例，主数字大字显示 **5 小时剩余额度**（紫色流动渐变，系统开启减少动态效果时自动静止），下方显示 **每周剩余额度**，每 60 秒自动刷新。
- **每轮消耗实时观测**：每轮回复结束后自动弹出 **`本轮消耗（观测）`**，对比本轮前后的官方已用百分比变化，以暗红色 **`X%`** 展示差值（未见变化显示 **`0%`**，并行任务标注 `期间额度变化`）；默认 5 秒自动收起，可在菜单「每轮消耗提示」关闭或调整停留秒数。
- **简洁点击循环交互**：
  1. **左键点击 GPT 角色** → 打开额度气泡（先即时展示上次缓存百分比并标注 `更新中`，新快照到达后替换）。
  2. **点击气泡** → 额度或本轮消耗 → 随机一句 **GPT / Prompt / Token 主题趣味文案**（或「自定义泡泡」中的队列内容） → 再点一次关闭。
  3. **悬停气泡右上角** → 点击 `↻` 立即手动刷新官方额度。
- **原生跟随 Codex 窗口**：通过 `WindowApi.cs` 识别并吸附 `Codex.exe` / `ChatGPT.exe` 窗口，随窗口移动、缩放与最小化；关闭 Codex 后保持待机等待，重新打开自动恢复。同时支持 `独立桌面模式.cmd` 与 Windows 登录开机自启。
- **Codex 本地插件集成**：配套 `gpt-quota-plugin-source/` 提供 `gpt_quota_widget` MCP 工具（`quota_read`、`quota_widget_status`、`quota_widget_start`、`quota_widget_stop`）与 `quota-widget` 技能，安装后可在对话中直接说「启动 GPT 额度挂件」「查看我剩余的 Codex 额度」等指令控制挂件。

## 目录结构

| 目录 | 说明 | 文档 |
| --- | --- | --- |
| `codex-quota-widget/` | Electron 透明桌面挂件、Windows 原生窗口跟随、设置面板与气泡视图 | [挂件详细说明](codex-quota-widget/README.md) |
| `gpt-quota-plugin-source/` | Codex 本地插件源码（MCP 工具服务、安装脚本与 Skill） | [插件说明](gpt-quota-plugin-source/README.md) |

## 快速开始

### 1. 环境要求

- Windows 10 / 11（桌面悬浮与窗口跟随依赖 Windows 原生接口）
- Node.js 24+ 与 npm
- 已安装并登录 **ChatGPT 账号** 的 Codex CLI（API Key 登录方式不提供订阅剩余额度）

### 2. 克隆仓库并安装 Codex 插件

```powershell
git clone https://github.com/muyuame/gpt-quota-widget.git
cd gpt-quota-widget
.\gpt-quota-plugin-source\安装插件.cmd
```

安装脚本会校验相邻的 `codex-quota-widget/` 完整性、生成适配本机路径的 MCP 配置并注册 `gpt-quota-widget@gpt-quota-local` 插件（也可直接运行 `codex-quota-widget\安装Codex插件.cmd`）。安装后新开 Codex 对话即可语音/文字调用。

### 3. 启动与管理桌面挂件

进入 `codex-quota-widget/` 目录，双击对应脚本即可：

- **启动挂件（跟随 Codex）**：`启动挂件.cmd`（首次运行会自动校验并安装 Electron 44.3.0 到 `data/desktop-runtime/`）。
- **独立桌面常驻模式**：`独立桌面模式.cmd`（无需打开 Codex 即可独立显示，可在菜单切回「跟随 Codex」）。
- **Windows 开机自启 / 取消自启**：`开启开机自启.cmd` / `关闭开机自启.cmd`。
- **停止挂件与监测**：`停止挂件.cmd`。

> 所有个人设置、角色素材、位置记忆、本地缓存、Electron 运行环境与日志均保存在 `codex-quota-widget/data/`（已加入 `.gitignore`，不会纳入 Git 版本控制）。

## 官方额度读取原理

- 调用本机 Codex CLI 提供的官方只读 RPC：`codex app-server --listen stdio://` 下的 `account/rateLimits/read`，通过 `剩余百分比 = clamp(100 - usedPercent, 0, 100)` 计算各窗口余量。
- 全程仅在本机进行只读通讯，不发起模型推理请求、不消费任何付费额度、不修改 Codex 主程序文件，也不读取或持久化登录凭据（账号切换会自动丢弃旧缓存，离线或暂不可用时清晰标注状态）。

## 运行测试

```powershell
# 挂件单元测试（协议、缓存、安全与交互等）
cd codex-quota-widget
npm test

# Electron 桌面渲染与系统审计烟测
node tests/desktop-audit-smoke.mjs

# Codex 插件 MCP 单元测试
cd ..\gpt-quota-plugin-source
node --test plugins/gpt-quota-widget/tests/mcp.test.mjs
```

## 鸣谢与许可

- 代码与文档基于 **MIT License** 开源，完整上游版权与贡献者声明见 [LICENSE](codex-quota-widget/LICENSE)。
- 上游脉络与致谢：
  - 原开源桌面挂件底座：[@MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（MIT）
  - Codex 桌面透明窗口与原生跟随适配层：[@Yang-huai406/Codex-Whale-Public](https://github.com/Yang-huai406/Codex-Whale-Public)（MIT，及 [macOS PR #128](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/pull/128) 贡献者 [@1llysviel](https://github.com/1llysviel)）
- 衍生版本：针对 **Google Antigravity** 的姊妹移植版 [muyuame/gemini-quota-widget](https://github.com/muyuame/gemini-quota-widget)（Gemini 娘 / 5 小时与每周额度 / Claude 额度切换气泡）。
- 素材与第三方依赖许可说明见 [PROVENANCE.md](codex-quota-widget/PROVENANCE.md) 与 [THIRD_PARTY_NOTICES.md](codex-quota-widget/THIRD_PARTY_NOTICES.md)（其中角色图片 `assets/gpt.avif` / `assets/gpt.png` 为用户提供素材，原挂件图片、动图与音频沿用上游条款随挂件分发；`vendor/smol-toml` 采用 BSD-3-Clause；Electron 运行时安装后保留其自身许可证与第三方声明；官方接口参考 [OpenAI Codex App Server 文档](https://learn.chatgpt.com/docs/app-server)）。
