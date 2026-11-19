# Agent Model Sync

让用户自定义的 VS Code 智能体自动使用与 Explore 相同的模型，新建智能体也自动加入。无网络、遥测、第三方依赖或轮询进程。

## 独立开发项目

直接在 VS Code 中打开本目录即可继续开发，无需安装依赖。

- `extension.cjs`：扩展宿主入口与文件监听。
- `sync-core.cjs`：发现、模型字段同步与备份安全检查。
- `test/`：隔离测试；通过 VS Code 任务 **Agent Model Sync: Test** 或 `npm test` 运行。
- `build_vsix.py`：本地 VSIX 打包；通过任务 **Agent Model Sync: Package VSIX** 或 `npm run package` 运行。
- `DEVELOPMENT.md`：当前安装边界、开发注意事项和 Marketplace 后续事项。

本项目从已验证的本地同步器复制而来，原目录、正在运行的扩展和用户备份均保留，未重新安装。正式显示名为 **Agent Model Sync**；为保持现有命令、设置与备份连续性，内部 ID 暂仍为 `belugarex-local.user-agent-model-sync`，本地 VSIX 文件名仍为 `user-agent-model-sync-0.1.0.vsix`。Marketplace publisher 和 package ID 在正式发布前单独确认；当前保留 `private: true`，不代表已经上架。

## 使用

继续通过 VS Code 或 Unify Chat Provider 的 Explore 模型入口切换模型。扩展只读监听 Explore 生成的模型配置，自动保留完整 provider 后缀和默认备用模型列表，写入所有用户智能体的顶层 `model` 字段。

自动发现当前扩展宿主上的：

- `~/.copilot/agents/` 直接子级的 `.agent.md` 和 `.md` 智能体；忽略隐藏文件、README、LICENSE、CHANGELOG。
- 当前 VS Code 用户配置目录 `User/prompts/` 直接子级的 `*.agent.md`。

当前智能体、以后新建的智能体、不同文件名/显示名及未填写 `name` 的智能体都会加入；不需要手工维护名单。文件新增、保存、删除及 Explore 模型变动都会触发重新发现。角色正文、工具权限及其他字段保持不变；无 YAML header 时仅增加包含模型的 header，保留原正文。

命令面板：

- **Agent Model Sync: 立即同步 Explore 模型**
- **Agent Model Sync: 查看模型同步状态**

设置 `userAgentModelSync.enabled` 为 false 或禁用本扩展即可暂停。已开始运行的子智能体不会中途换模型；调用方显式指定模型仍可能覆盖文件偏好。

## 范围与兼容性

这是 **用户级 Local/VS Code 格式**同步器，不改工作区 `.github/agents`、扩展内置智能体、Claude 智能体、Unify 或 Copilot 安装文件，也不递归扫描 HOME。`target: github-copilot` 等不兼容格式会逐文件报告并跳过，避免将 Local 显示名误写成另一 harness 的 runtime ID。坏文件、脏编辑器或不安全文件也逐一报告，不阻塞其他正常智能体。

只读来源为当前扩展 globalStorage 同级的 `github.copilot-chat/explore-agent/Explore.agent.md`。**这是本地适配的内部缓存契约，不是 VS Code 官方“继承 Explore”API**；已核对 VS Code 1.147.0 / Copilot 0.75.0。未来缓存路径/格式变更可能需要更新。来源不存在或无有效模型时阻塞，不猜模型也不删除现有模型。不同窗口共享 HOME 时，用户智能体文件也是共享的，最后一次同步生效。

## 从旧同步器迁移

首次启动新扩展，先通过 VS Code 设置 API 关闭旧 `cavecrewModelSync.enabled` 并等待旧扩展确认停止，之后才开始写入，避免双写。若旧工作区设置强制开启而全局关闭未生效，新扩展会阻塞并要求停用旧扩展，不改动工作区设置。完成迁移后可卸载旧扩展；旧源码和备份保留，不与新扩展同时运行。

## 备份与安全

- 每个用户文件在首次同步前保存原始备份：扩展 globalStorage 下 `originals/copilot/<文件名>` 或 `originals/profile/<文件名>`，0600、只创建不覆盖。
- 旧版两个 Cavecrew 的原始备份会迁入新目录，保留最初“未设置 model”的状态，而不是把旧同步结果误当原始值。
- 拒绝符号链接根目录、文件及备份；严格 UTF-8，256 KiB 上限；保留文件 mode。写前比较、防并发覆盖；写后读回检查。
- 多文件是逐个同步，不保证跨文件事务。错误会出现在状态和输出中。
- 当前 WSL 状态和备份目录：`~/.vscode-server/data/User/globalStorage/belugarex-local.user-agent-model-sync/`。`status.json` 包含实际激活版本、发现数量、成功路径和逐文件错误。

## 停用、回滚与文件位置

禁用/卸载 **Agent Model Sync**（现有旧安装仍显示“用户智能体模型同步”）后，若保留当前固定模型，无需继续操作。若恢复原来模型行为，对照 `originals/` **只恢复 model 字段**，不要整文件覆盖后来对角色/权限的编辑。两个原有 Cavecrew 最初没有 model，可移除该字段。

当前开发目录：`~/hkust/agent-model-sync/`，拥有独立本地 Git 仓库，未配置远程或推送。原始已安装版本对应的源码与 VSIX 保留在 `~/.local/share/user-agent-model-sync/`；更旧的 `~/.local/share/cavecrew-model-sync/` 仅为历史回滚资料，勿误装其 VSIX。迁移历史保存在本地 `.planning/local-sync-history/`，不纳入 Git 或 VSIX。无需修改 AC-UST 或重装 Copilot。

## 开发与验收

标准测试为 `node --test test/*.test.cjs`；打包为 `python3 build_vsix.py`，只使用 Node/Python 标准库。`verify-live.cjs` 是本机 WSL 安装验收脚本，只读验证实际激活版本、动态目标名单、模型值、原始正文/权限和安装源一致性。**新目录的品牌改动尚未安装，不能把旧安装的通过记录当作新源码的真实宿主验证；安装与源码不一致时此脚本会拒绝通过。**

隔离测试覆盖新增/删除任意文件名、plain Markdown/profile、无 name/header、A→B→默认列表、CRLF/BOM、保留 mode/备份、旧备份迁移、重复同步、符号链接/错误格式/脏编辑器和逐文件异常。VS Code API 为模拟对象，磁盘为真实隔离临时目录；安装后另行验证当前宿主的真实新增文件发现，不改用户 Explore 选择进行试验。
