# TOEFL Card Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现每天 20–30 分钟、写作优先的托福卡片学习网站并推送 GitHub。
**Architecture:** 静态页面，app.js 处理界面和浏览器功能，core.js 提供可测试的学习规则，data/cards.json 保存 182 张素材。浏览器本地保存学习记录，文件导出支持迁移。
**Tech Stack:** 原生 HTML/CSS/JavaScript ES modules，Node test runner，GitHub Pages。

## Task 1 学习内容与独立仓库
- [ ] 创建 data/cards.json，保留 182 个唯一编号，核对模块数量与全部字段。
- [ ] 写入 docs/design.md、当前实施计划、README 与 .gitignore；在独立目录初始化功能分支。
- [ ] 数据验证命令：node --test tests/data.test.mjs；预期全字段存在、模块数量为 62/60/36/24。

## Task 2 学习规则与测试
文件 core.js、tests/core.test.mjs。先写测试并观察缺失模块/功能导致失败，再实现。
- [ ] createState、dayKey 采用 Asia/Shanghai；状态含 settings/cards/days/session。
- [ ] buildQueue 旧卡到期优先，新卡按配额与星期日规则，不重复；过滤模块和领域。
- [ ] recordReview 不修改输入，记录首次接触与复习；again/hard/good 调整下次日期；不同日期两次正确才计稳定。
- [ ] progressCounts、addStudySeconds、makeCloze、normalizeAnswer、validateImport 可单独验证。
- [ ] 测试错误答案、日期边界、未知卡片、损坏导入与时间上限。

## Task 3 界面与卡片训练
文件 index.html、styles.css、app.js。
- [ ] 首页今日任务、模块入口；素材库搜索与筛选；进度与设置页。
- [ ] 学习流程：显示中文/语境，主动输入或填空/拼句，显示参考，再自行评定。
- [ ] 复述先隐藏英文；语音播放与录音回听均有不支持/权限失败提示。
- [ ] 20/30 分钟计时、暂停恢复、隐藏与闲置暂停；仅完成活动后可手动标今日完成。
- [ ] 保存当前位置与进度；导出/校验导入；存储失败不能宣称已保存。

## Task 4 验证与交付
- [ ] node --test tests/*.test.mjs；node --check app.js；预期均通过。
- [ ] 本地静态服务与浏览器检查桌面、手机、学习评分、刷新恢复、筛选、导出与不支持语音的降级。
- [ ] 规格审查后进行代码质量审查，修复重要问题并重跑相关测试。
- [ ] 提交源文件，推送 GitHub；能启用 Pages 时验证线上链接，外部认证阻塞时保留可运行成果并准确报告。
