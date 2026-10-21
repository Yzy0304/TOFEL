# Progress Sync Implementation Plan

**Goal:** 自动同步手机与 Mac 的学习记录并安全合并旧备份。
**Architecture:** sync-core.js 负责确定性合并和重放；sync-client.js 负责本地日志、认证及乐观并发；sync-ui.js 负责登录与状态；Supabase RLS 限制账号。
**Tech Stack:** JavaScript ES modules, Node test runner, Supabase Auth/PostgREST/Postgres.

- [x] 建立合并、重放、幂等、时长及独立作答测试，确认失败后实现 sync-core.js。
- [x] 建立存储失败、并发上传、失败重试及账号绑定测试，实现 sync-client.js。
- [x] 接入现有所有学习操作和导入导出；登录界面提供邮箱一次性登录链接，离线状态可见。
- [x] 创建受 RLS 保护的同步文档表及 CAS 函数，核实匿名不可访问。
- [x] 完整自动测试、本机浏览器演练、Pages 打包与发布。
- [ ] 真实登录由用户完成，验证状态与尚未完成部分准确记录。

## 验证记录（2026-10-21）
309 项测试通过，独立检查发现的同毫秒因果顺序问题已回归修复。隔离端口完成独立作答、刷新恢复验证；本机原有两张卡片保留。云端 RLS 已启用、三条本人账号策略存在，匿名 SELECT 与保存 RPC 均无权限，函数遵循调用者权限。在线部署资源逐项与本地核对一致。本人登录邮件已成功发出，真实两端账号同步等待用户打开邮件链接验证。
