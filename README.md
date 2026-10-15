# 词境 TOEFL Card Studio

每天 20–30 分钟的托福表达卡片网站。重点是 Email 与 Academic Discussion，穿插场景复述和 Interview。完整写作不属于每日卡片任务。

## 使用
- 今日学习：旧卡优先，每天通常新学 4 张，周日只复习。
- 素材库：按模块、领域、关键词查找；单纯查看不计为掌握。
- 主动回忆、语境填空、词块拼句、听后复述四种练法。
- 回忆后自评“不记得／有点印象／记得”；不同日期两次正确才计为稳定回忆。
- 20/30 分钟可切换，支持暂停、继续、后台与闲置暂停。
- 设置页导出 JSON 备份；导入前校验并确认替换。学习记录不会自动跨设备同步。
- 语音来自浏览器英文语音；录音需要 HTTPS 或 localhost，文件仅保存在页面内存中，不上传、不自动评分。

## 内容
Email 62 张，Discussion 60 张，场景复述 36 张，Interview 24 张，共 182 张。例句为主题整理与自编，来源说明见卡片及设置页，不是官方预测题。原培训机构 Word 与截图不在仓库内。

## 本地运行
使用 Node 22+ 或支持 ES modules 的现代浏览器，静态服务即可，无依赖安装步骤。
终端在仓库目录运行 `python3 -m http.server 4173`，打开 http://localhost:4173 。不要直接双击 index.html，因为浏览器会限制本地 JSON 读取。

验证：`node --test tests/*.test.mjs`；语法检查：`node --check app.js`。

## GitHub Pages
将项目推送到 GitHub 后，进入仓库 Settings → Pages，选择 Deploy from a branch，选择网站分支和 /(root)，保存。所有资源使用相对路径，支持项目子路径。也可以启用随附的 Pages Actions 工作流。

## 文件
- index.html / styles.css：响应式界面
- app.js：学习交互、语音、录音和本地保存
- core.js：队列、间隔复习、进度、导入校验
- data/cards.json：素材库
- docs/handbook.md：完整备考手册
- tests：学习规则与内容验证

实际学习时长与自评记录不能替代官方托福评分。