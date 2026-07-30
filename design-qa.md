# Ask AI 任务交互设计 QA

## 对照范围

- 设计源：`design/novel-tool-ui.pen`
- 配置态画板：`hD8ot`
- 运行态画板：`T1PJnX`
- 结果态画板：`nledm`
- 实现页面：Electron 写作页右侧「当前任务」
- 视口：`1440 × 1024`
- 状态：选中正文后进入润色任务，分别检查配置、运行和结果阶段

## 尺寸与密度归一化

- Pencil 导出为 `2880 × 2048`（2x）。
- 实现截图为 `1440 × 1024`（1x）。
- 对照前将 Pencil 导出缩放为 `1440 × 1024`，未裁切、未改变宽高比。
- 归一化设计稿位于 `artifacts/design-qa/normalized/`。
- 实现截图位于 `artifacts/design-qa/implementation/`。

## 全视图对照

- 配置态：`artifacts/design-qa/comparison/configuration-reference-vs-implementation.png`
- 运行态：`artifacts/design-qa/comparison/running-reference-vs-implementation.png`
- 结果态：`artifacts/design-qa/comparison/result-reference-vs-implementation.png`

全视图检查确认：顶部栏、左侧模块栏、章节树、编辑器、420px 任务侧栏的整体分区与设计稿一致；任务侧栏在三个阶段均保持打开，不再随着单步执行反复折叠。

## 重点区域对照

- 配置态侧栏：`artifacts/design-qa/comparison/configuration-sidebar-focus.png`
- 运行态侧栏：`artifacts/design-qa/comparison/running-sidebar-focus.png`
- 结果态侧栏：`artifacts/design-qa/comparison/result-sidebar-focus.png`

重点检查了任务标题、模型标识、状态标签、执行记录、长要求摘要、候选结果和底部操作区。实现沿用设计稿的信息层级，同时根据最终交互决定做了两处有意调整：

1. 选择任务后立即隐藏选区悬浮工具条，避免遮挡正文。
2. 原生蓝色选区改为低干扰暖色锁定高亮，直到任务被应用、忽略或结束。

## 检查结果

- P0：无。
- P1：无。
- P2：无。
- P3：测试工作区没有配置真实模型，因此截图显示「模型未配置」；配置完成后该位置显示实际模型名，不属于布局缺陷。
- P3：E2E 使用最小章节和短选区，正文内容密度低于设计稿；任务侧栏尺寸、层级、间距和状态行为不受影响。
- 通过项：配置态不会在用户填写要求前调用模型。
- 通过项：运行态显示真实发生的阶段，已完成记录不折叠、不伪造固定工具步骤。
- 通过项：结果态候选内容不会自动写入正文，保留重新生成、忽略、加入草稿纸和应用替换。
- 通过项：超长要求在结果态折叠为摘要，可展开修改并重新生成，不挤压候选结果。
- 通过项：模型名称位于固定侧栏标题区，不会被任务内容遮挡。

## 对照迭代记录

1. 初次对照发现编辑器 `100%` 默认宽度与右侧栏像素宽度冲突，任务栏被压缩到最小宽度。
2. 调整为侧栏打开时由编辑器占用剩余空间，任务侧栏默认 `420px`，并保留用户拖拽后的布局持久化。
3. 重新打包并运行真实 Electron 四任务回归，润色、扩写、校对、续写全部通过。
4. 再次完成全视图和侧栏重点区域对照，未发现阻塞交付的视觉或交互偏差。

## 2026-07-30 底部操作栏复查

- 用户截图暴露出配置态操作栏仍按普通内容块排版，未真正贴在侧栏底部；此前 QA 对该项判断错误。
- 修正后让任务卡占满侧栏可用高度，短内容时操作栏由自动空间推至底部，长内容时继续保持 sticky。
- 配置态去掉重复提示，只保留一个紧凑主操作；运行态和结果态仍保留必要的状态说明。
- 当前设计稿与修正后实现的同尺寸并排图：`artifacts/design-qa/footer-fix/comparison/configuration-reference-vs-implementation.png`。
- 新增 Electron 回归断言：配置态操作栏距侧栏底部不超过 20px，高度不超过 72px；运行态和结果态允许状态说明占用的额外高度。
- 润色、扩写、校对、续写四个真实 Electron UI 流程复测通过。

## 2026-07-30 底栏视觉复查

- 第二张用户截图证明前一轮只修复了位置，没有消除内缩、阴影和卡片感；“没变化”的反馈成立。
- 底栏现已改为与设计稿一致的全宽结构：取消模糊与阴影，只保留一条顶部边线，背景使用侧栏表面色。
- 配置态主按钮恢复设计稿的 `138 × 40px`、方向图标和更清晰的标签字号。
- 运行态不再同时显示“停止生成”和禁用的“开始”按钮，只保留当前可执行操作。
- 回归新增全宽、无阴影、无 backdrop-filter、按钮最小尺寸和运行态按钮数量检查。
- 当前设计稿与实现的底栏重点对照：`artifacts/design-qa/footer-style-audit/comparison/reference-vs-fixed-footer.png`。

final result: passed
