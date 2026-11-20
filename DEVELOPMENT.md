# Agent Model Sync — 开发交接

## 当前项目

- 工作区目录：`~/hkust/agent-model-sync/`。
- 名称已确定为 **Agent Model Sync**，不使用 Relay 或 Cavecrew 作为产品品牌。
- 当前为本地开发版 0.1.0，MIT 许可，CommonJS，无第三方运行依赖。
- Node.js 20+ 与 Python 3 可运行原有隔离测试和标准库打包；标准 Marketplace 打包开发工具需要 Node.js 22+ 与 npm 开发依赖。
- GitHub 公开源码仓库：<https://github.com/BelugaRex/agent-model-sync>，主分支为 `main`；反馈入口为 [GitHub Issues](https://github.com/BelugaRex/agent-model-sync/issues)。源码公开不等于 Marketplace 上架；目前未发布到扩展市场。

## 开发入口

打开本目录作为 VS Code 工作区，运行内置任务：

1. **Agent Model Sync: Test**：隔离测试，真实临时文件系统和模拟 VS Code API；不写真实用户智能体。
2. **Agent Model Sync: Package VSIX**：生成 `dist/user-agent-model-sync-0.1.0.vsix`，仅打包 manifest、两个运行时文件、README 和 LICENSE，不自动安装。

同等 npm 入口为 `npm test` 和 `npm run package`。`dist/` 在首次打包时自动创建，重新打包会覆盖同名产物；需要留存的旧包应先另存。生成目录不纳入 Git。

### 标准 Marketplace 候选包（仅本地）

- Node.js 22+、npm 和 Python 3；`npm ci --ignore-scripts` 安装锁定的开发工具，扩展运行仍无第三方依赖。
- `npm run package:list` 检查显式白名单；`npm run package:marketplace` 生成独立的 `dist/user-agent-model-sync-0.1.0-marketplace.vsix`，不会覆盖旧 Python 包，也不会上传市场。
- `npm run verify:package` 验证实际 ZIP 条目、CRC、XML、身份及源码一致性；规划、脚本、测试、开发文档和依赖均不打入包。
- `npm run test:package` 在真实临时目录验证首次打包、开发文件排除、公开链接元数据及异常包拒绝；需已安装开发依赖和 Node.js 22+，不会加载扩展或接触真实智能体。
- 最低 VS Code 版本收紧为 `^1.147.0`，不再声明未经验证的 1.100.0；后续版本和其他平台仍需真实宿主证据。
- 正式身份、图标、实际候选包的隔离宿主验证、迁移及上传关卡见 `PUBLISHING.md`；真实源码/反馈链接已填入 manifest。没有 publish 脚本或发布工作流。

## 已安装版与开发源码分离

原始源码保留在 `~/.local/share/user-agent-model-sync/`，已安装扩展仍为 `belugarex-local.user-agent-model-sync@0.1.0`，界面仍使用原中文名称。当前候选源码已应用用户明确确认的 Publisher ID `BelugaRex`，完整身份为 `BelugaRex.user-agent-model-sync`；**没有重装扩展或修改真实智能体及备份**。

package name、命令 `userAgentModelSync.*` 和设置 `userAgentModelSync.enabled` 不变。publisher 改变了扩展 ID 和 globalStorage：新版本在注册命令前检查旧 local ID，只要宿主仍暴露该扩展（即使未激活）便拒绝启动，要求先停用/卸载并重载所有共用 HOME 的窗口，不通过共享设置误停两者。早期拒绝会显示激活错误，不创建新的状态文件；后续同步遇到旧实例则记录 blocked。此检查不是跨进程锁。

旧 local storage 的 `originals/copilot/` 和 `originals/profile/` 按发现目标只读复制到新 storage，不覆写已存在的新 originals；现代备份缺失时才回退两个历史 Cavecrew originals，最后才使用当前文件。旧备份异常不静默回退。安装前应单独保留原备份，并保留旧 storage 供迁移。Cavecrew 的独立设置停写逻辑不变；隔离回归不能替代实际候选包宿主验证。

真实宿主测试可能修改 `~/.copilot/agents/` 等用户文件。暂未提供一键启动第二个同步实例的调试配置。需要现场调试时，先确认现有 writer 已停用，并保护原始备份，避免多窗口/多实例双写。扩展升级后还须重载并确认实际激活代码，不能只看磁盘版本。

`verify-live.cjs` 是当前 WSL 机器专用的只读安装验收，不是通用 CI。它按 manifest 的小写扩展 ID 定位 storage 和安装目录，要求此目录与安装资产一致；新身份源码尚未安装，因此不要把旧目录的历史 PASS 当作新源码的宿主验证。

## 功能边界

同步器只读 `github.copilot-chat/explore-agent/Explore.agent.md` 的 `model`，动态发现用户级智能体，只修改其 `model` 字段；角色、工具、其他 frontmatter 和原始备份保持原有规则。工作区 `.github/agents` 不在同步范围。

Explore 来源属于 **Copilot 内部缓存契约，并非官方公开继承 API**。此前验证环境为 VS Code 1.147.0 / Copilot 0.75.0；不能据此声称其他平台、配置或后续版本已经验证。

## Marketplace 发布前关卡（尚未上架）

- Publisher ID `BelugaRex` 已由用户明确确认并应用，保留 package name `user-agent-model-sync`；旧 local ID 防双写及 originals 迁移已加入隔离回归，正式安装前仍需先停旧实例并重载。
- 公开 README 和 CHANGELOG、真实源码/反馈入口已准备；图标与兼容性矩阵仍待完善。自动写入、隐私和恢复边界须在发布前再次复核。
- 当前 `private: true` 可防误发 npm，但不是 Marketplace 私有开关，也不会阻止 vsce 发布；用户提供身份不等于已独立验证服务端所有权/上传权限。
- Python 打包器继续用于本地 VSIX；标准官方候选包采用固定版本 `@vscode/vsce`、显式白名单与锁文件，已移除缺失 repository 的绕过选项。打包通过不等于上架审核或真实宿主通过。
- GitHub 源码公开和本轮身份更新已获授权；GitHub Release/VSIX 上传、实际安装与 Marketplace 最终上传不自动执行。规划三件套和用户尚未提交的改动不随本轮源码推送上传。

当前规划三件套直接放在 `.vscode/task_plan.md`、`.vscode/findings.md` 和 `.vscode/progress.md`，后续复用这三份文件，不再按任务新建日期目录。规划材料不打入 VSIX；是否纳入 Git 以用户当前规则为准，本轮保留用户 `.gitignore` 改动、暂不提交三件套。`.vscode/tasks.json` 仍纳入 Git。旧 `.planning/` 已不在工作区，不作为当前计划入口。后续开发应从本文件和 README 开始，不必依赖 AC-UST 仓库。
