# 墨枢 V1 使用指南

这份文件保留为 V1 开发与测试入口。面向作者的完整说明请阅读：

- [墨枢使用说明书](./USER_MANUAL.md)

## 运行命令

```bash
npm install
npm run dev
npm run build
npm run typecheck
npm test
npm run test:e2e
```

- `npm run dev`：启动本地 Electron 开发版。
- `npm run build`：打包本地 Electron 应用。
- `npm run typecheck`：运行 TypeScript 类型检查。
- `npm test`：运行单元和集成测试。
- `npm run test:e2e`：运行 Electron 端到端测试，执行前需要先 `npm run build`。

开发版会在主进程终端打印发送给 OpenRouter 的完整 AI prompt，日志前缀为 `[MoShu Dev LLM Prompt]`。如果当前环境没有把 `NODE_ENV` 设为 `development`，可以用 `NOVEL_TOOL_LOG_LLM_PROMPTS=1 npm run dev` 强制开启；用 `NOVEL_TOOL_LOG_LLM_PROMPTS=0 npm run dev` 可以关闭。日志包含小说正文片段，不会写入项目文件，也不会打印 OpenRouter API Key。

## 核心流程

- `继续写作`：选择并打开已有 `.noveltool` 项目文件，也可以从最近项目列表打开。
- `新建作品`：创建新的 `.noveltool` 项目文件，填写小说名称和每章目标字数。
- `导入小说`：把 TXT 导入为新项目；从写作页进入导入时，可以追加到当前项目末尾。
- 写作页左侧管理章节，当前版本只允许在最后一章后新建章节。
- 中间编辑器用于写正文；重新打开项目会回到上次写作章节；切换章节、返回开始页、进入导入或设置前会先尝试保存。
- 顶栏搜索会列出匹配章节和段落；点击正文匹配结果会跳到对应段落并高亮关键词。
- 右侧栏包含 `AI 对话`、`当前任务`、`草稿纸`。
- 选中文字后可用 `Ask AI` 调用润色、扩写、校对、续写。
- AI 结果必须由用户确认后才会写回正文。
- 导出页支持 TXT 正文导出，不导出草稿纸、AI 对话或章节索引缓存。

## 数据与安全

- `.noveltool` 项目文件包含章节正文、草稿纸、AI 对话、AI 任务和章节索引缓存。
- OpenRouter API Key 不保存在 `.noveltool` 项目文件里。
- 只有主动使用 AI 功能或章节索引缓存时，相关文本才会发送给 OpenRouter。
- 普通写作、普通保存和 TXT 导出不会自动发送正文。
- 当前版本保留本机应急草稿恢复，但不提供章节历史版本功能。

## 作者说明书

完整作者手册包含快速上手、新建项目、TXT 导入、编辑器、AI 任务、AI 对话、支持的问题例子、章节索引缓存、导出、备份和常见问题：

- [docs/USER_MANUAL.md](./USER_MANUAL.md)
