# Agent Model Sync — 开发交接

## 当前项目

- 工作区目录：`~/hkust/agent-model-sync/`。
- 名称已确定为 **Agent Model Sync**，不使用 Relay 或 Cavecrew 作为产品品牌。
- 当前为本地开发版 0.1.0，MIT 许可，CommonJS，无第三方运行依赖。
- Node.js 20+ 与 Python 3 可运行现有测试和本地打包。没有前端、编译或依赖安装步骤。
- 已建立独立 Git 仓库；没有远程仓库、推送或 Marketplace 发布。

## 开发入口

打开本目录作为 VS Code 工作区，运行内置任务：

1. **Agent Model Sync: Test**：10 项隔离测试，真实临时文件系统和模拟 VS Code API；不写真实用户智能体。
2. **Agent Model Sync: Package VSIX**：生成 `dist/user-agent-model-sync-0.1.0.vsix`，仅打包 manifest、两个运行时文件、README 和 LICENSE，不自动安装。

同等 npm 入口为 `npm test` 和 `npm run package`。`dist/` 在首次打包时自动创建，重新打包会覆盖同名产物；需要留存的旧包应先另存。生成目录、本地规划及缓存不纳入 Git。

## 已安装版与开发源码分离

原始源码保留在 `~/.local/share/user-agent-model-sync/`，已安装扩展仍为 `belugarex-local.user-agent-model-sync@0.1.0`，界面仍使用原中文名称。本次仅复制项目并修改新源码品牌，**没有移动原目录、重装扩展或修改真实智能体及备份**。

内部 package name、命令 `userAgentModelSync.*` 和设置 `userAgentModelSync.enabled` 暂时不变。改 displayName 不会改变这些标识；更改 publisher/package name 则会改变扩展 ID 和 globalStorage。以后确定公开身份时需设计旧实例停用和原始备份迁移，不能直接安装两个同时写入的同步器。

真实宿主测试可能修改 `~/.copilot/agents/` 等用户文件。暂未提供一键启动第二个同步实例的调试配置。需要现场调试时，先确认现有 writer 已停用，并保护原始备份，避免多窗口/多实例双写。扩展升级后还须重载并确认实际激活代码，不能只看磁盘版本。

`verify-live.cjs` 是当前 WSL 机器专用的只读安装验收，不是通用 CI。它要求此目录与安装资产一致；新品牌源码尚未安装，因此不要把旧目录的历史 PASS 当作新源码的宿主验证。

## 功能边界

同步器只读 `github.copilot-chat/explore-agent/Explore.agent.md` 的 `model`，动态发现用户级智能体，只修改其 `model` 字段；角色、工具、其他 frontmatter 和原始备份保持原有规则。工作区 `.github/agents` 不在同步范围。

Explore 来源属于 **Copilot 内部缓存契约，并非官方公开继承 API**。此前验证环境为 VS Code 1.147.0 / Copilot 0.75.0；不能据此声称其他平台、配置或后续版本已经验证。

## Marketplace 后续事项（本次未执行）

- 确认并注册真实 publisher，决定 package ID 是否改为 `agent-model-sync`，设计旧版迁移与防双写。
- 完成公开 README、图标、CHANGELOG、隐私与兼容性说明，并复核支持版本。
- 当前 `private: true` 和 `belugarex-local` 为本地阶段标记；未检查正式名称/ID 的 Marketplace 可用性。
- 当前 Python 打包器用于本地 VSIX；正式发布前按 Marketplace 流程验证发布包，不能把本地打包成功等同于上架审核通过。
- GitHub 建仓、远程地址、推送、发布及账户操作需要另行明确，不在本次目录整理范围。

当前规划三件套直接放在 `.vscode/task_plan.md`、`.vscode/findings.md` 和 `.vscode/progress.md`，后续复用这三份文件，不再按任务新建日期目录。它们仅作本地记录，不随 Git 或 VSIX 分发；`.vscode/tasks.json` 仍纳入 Git。旧任务与迁移历史保留在 `.planning/`，仅作历史存档，不作为当前计划入口。新工作区后续开发应从本文件和 README 开始，不必依赖 AC-UST 仓库。
