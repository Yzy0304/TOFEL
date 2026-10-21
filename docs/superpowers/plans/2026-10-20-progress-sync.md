# Progress Sync Implementation Plan

**Goal:** 自动同步手机与 Mac 的学习记录并安全合并旧备份。
**Architecture:** sync-core.js 负责确定性合并和重放；sync-client.js 负责本地日志、认证及乐观并发；sync-ui.js 负责登录与状态；Supabase RLS 限制账号。
**Tech Stack:** JavaScript ES modules, Node test runner, Supabase Auth/PostgREST/Postgres.

- [x] 建立合并、重放、幂等、时长及独立作答测试，确认失败后实现 sync-core.js。
- [x] 建立存储失败、并发上传、失败重试及账号绑定测试，实现 sync-client.js。
- [x] 接入现有所有学习操作和导入导出；登录界面提供邮箱一次性登录链接，离线状态可见。
- [x] 创建受 RLS 保护的同步文档表及 CAS 函数，核实匿名不可访问。
- [ ] 完整自动测试、本机浏览器演练、Pages 打包与发布。
- [ ] 真实登录由用户完成，验证状态与尚未完成部分准确记录。
