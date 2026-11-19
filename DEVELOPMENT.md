# Agent Model Sync — 开发交接

## 当前项目

- 工作区目录：`~/hkust/agent-model-sync/`。
- 名称已确定为 **Agent Model Sync**，不使用 Relay 或 Cavecrew 作为产品品牌。
- 当前为本地开发版 0.1.0，MIT 许可，CommonJS，无第三方运行依赖。
- Node.js 20+ 与 Python 3 可运行原有隔离测试和标准库打包；标准 Marketplace 打包开发工具需要 Node.js 22+ 与 npm 开发依赖。
- GitHub 私有源码仓库：<https://github.com/BelugaRex/agent-model-sync>，主分支为 `main`。源码托管不等于公开发行或 Marketplace 上架；目前未发布到扩展市场。

## 开发入口

打开本目录作为 VS Code 工作区，运行内置任务：

1. **Agent Model Sync: Test**：10 项隔离测试，真实临时文件系统和模拟 VS Code API；不写真实用户智能体。
2. **Agent Model Sync: Package VSIX**：生成 `dist/user-agent-model-sync-0.1.0.vsix`，仅打包 manifest、两个运行时文件、README 和 LICENSE，不自动安装。

同等 npm 入口为 `npm test` 和 `npm run package`。`dist/` 在首次打包时自动创建，重新打包会覆盖同名产物；需要留存的旧包应先另存。生成目录不纳入 Git。

### 标准 Marketplace 候选包（仅本地）

- Node.js 22+、npm 和 Python 3；`npm ci --ignore-scripts` 安装锁定的开发工具，扩展运行仍无第三方依赖。
- `npm run package:list` 检查显式白名单；`npm run package:marketplace` 生成独立的 `dist/user-agent-model-sync-0.1.0-marketplace.vsix`，不会覆盖旧 Python 包，也不会上传市场。
- `npm run verify:package` 验证实际 ZIP 条目、CRC、XML、身份及源码一致性；规划、脚本、测试、开发文档和依赖均不打入包。
- `npm run test:package` 在真实临时目录验证首次打包、开发文件排除及异常包拒绝；需已安装开发依赖和 Node.js 22+，不会加载扩展或接触真实智能体。
- 最低 VS Code 版本收紧为 `^1.147.0`，不再声明未经验证的 1.100.0；后续版本和其他平台仍需真实宿主证据。
- 正式身份、图标/反馈入口、实际候选包的隔离宿主验证、迁移及上传关卡见 `PUBLISHING.md`。没有 publish 脚本或发布工作流。

## 已安装版与开发源码分离

原始源码保留在 `~/.local/share/user-agent-model-sync/`，已安装扩展仍为 `belugarex-local.user-agent-model-sync@0.1.0`，界面仍使用原中文名称。本次仅复制项目并修改新源码品牌，**没有移动原目录、重装扩展或修改真实智能体及备份**。

内部 package name、命令 `userAgentModelSync.*` 和设置 `userAgentModelSync.enabled` 暂时不变。改 displayName 不会改变这些标识；更改 publisher/package name 则会改变扩展 ID 和 globalStorage。以后确定公开身份时需设计旧实例停用和原始备份迁移，不能直接安装两个同时写入的同步器。

真实宿主测试可能修改 `~/.copilot/agents/` 等用户文件。暂未提供一键启动第二个同步实例的调试配置。需要现场调试时，先确认现有 writer 已停用，并保护原始备份，避免多窗口/多实例双写。扩展升级后还须重载并确认实际激活代码，不能只看磁盘版本。

`verify-live.cjs` 是当前 WSL 机器专用的只读安装验收，不是通用 CI。它要求此目录与安装资产一致；新品牌源码尚未安装，因此不要把旧目录的历史 PASS 当作新源码的宿主验证。

## 功能边界

同步器只读 `github.copilot-chat/explore-agent/Explore.agent.md` 的 `model`，动态发现用户级智能体，只修改其 `model` 字段；角色、工具、其他 frontmatter 和原始备份保持原有规则。工作区 `.github/agents` 不在同步范围。

Explore 来源属于 **Copilot 内部缓存契约，并非官方公开继承 API**。此前验证环境为 VS Code 1.147.0 / Copilot 0.75.0；不能据此声称其他平台、配置或后续版本已经验证。

## Marketplace 发布前关卡（尚未上架）

- 确认并注册真实 publisher，决定 package ID 是否改为 `agent-model-sync`，设计旧版迁移与防双写。
- 公开 README 和 CHANGELOG 已准备；图标、真实反馈入口与兼容性矩阵仍待完善。自动写入、隐私和恢复边界须在发布前再次复核。
- 当前 `private: true` 可防误发 npm，但不是 Marketplace 私有开关，也不会阻止 vsce 发布；`belugarex-local` 是否注册及正式名称/ID 可用性尚未确认。
- Python 打包器继续用于本地 VSIX；标准官方候选包采用固定版本 `@vscode/vsce`、显式白名单与锁文件。打包通过不等于上架审核或真实宿主通过。
- GitHub 私有源码托管已获本轮授权；仓库公开、GitHub Release/VSIX 上传、Marketplace 发布、发布身份变更仍需另行明确。规划三件套和用户尚未提交的改动不随本轮源码推送上传。

当前规划三件套直接放在 `.vscode/task_plan.md`、`.vscode/findings.md` 和 `.vscode/progress.md`，后续复用这三份文件，不再按任务新建日期目录。规划材料不打入 VSIX；是否纳入 Git 以用户当前规则为准，本轮保留用户 `.gitignore` 改动、暂不提交三件套。`.vscode/tasks.json` 仍纳入 Git。旧 `.planning/` 已不在工作区，不作为当前计划入口。后续开发应从本文件和 README 开始，不必依赖 AC-UST 仓库。
