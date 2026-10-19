---
name: quota-widget
description: 启动、显示、关闭或检查 GPT 额度挂件，以及查询当前 Codex 官方剩余额度百分比。用户提到 GPT 挂件、额度挂件或请求用挂件查看额度时使用。
---

使用本插件的 `gpt_quota_widget` MCP 工具完成请求：

- 启动或重新显示挂件：`quota_widget_start`。未指定显示模式时省略 mode，保留现有设置；明确要求跟随 Codex 时传 `follow-codex`，要求独立桌面时传 `standalone`。
- 关闭挂件：`quota_widget_stop`，它同时停止挂件监控进程。
- 查看运行情况：`quota_widget_status`。visible 为 false 可能是 Codex 最小化或窗口不可见；根据返回的 message 说明。
- 查询额度：`quota_read`；要求立即刷新时传 `refresh: true`。查询本身不启动人物窗口。

启动、关闭后以工具返回的状态确认结果。额度用 `remainingPercent` 表示剩余百分比，分别报告 5 小时和每周窗口；`usedPercent` 是已用百分比。stale 为 true 时说明这是上次读取值。接口不可用或没有窗口时说明原因，不推算额度，不把 token 数换算为订阅百分比。

插件复用本机现有 GPT 形象挂件，保留其样式和设置。人物由透明桌面窗口显示；插件不注入或修改 Codex 聊天界面。不要为普通启动请求开启开机自启、修改其他插件或重新安装 Electron。
