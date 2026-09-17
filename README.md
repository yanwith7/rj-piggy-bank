# 窝头RJの存钱罐

只供个人使用的离线资产快照工具。它是一个 macOS / Windows 桌面应用，不含账号、云端同步、分析埋点、自动更新或任何外部请求。

## 下载与机型选择

请从 [最新正式下载页](https://github.com/yanwith7/rj-piggy-bank/releases/latest) 下载，不要下载 Code 页面里的 Source code ZIP。v0.1.5 起提供可直接打开的 `.dmg` 和 `.exe`，不需要解压。

| 你的电脑 | 下载文件 |
| --- | --- |
| Mac（M1 / M2 / M3 / M4 等 Apple 芯片） | [`RJ-Piggy-Bank-0.1.5-mac-arm64.dmg`](https://github.com/yanwith7/rj-piggy-bank/releases/download/v0.1.5/RJ-Piggy-Bank-0.1.5-mac-arm64.dmg) |
| Mac（Intel 芯片） | [`RJ-Piggy-Bank-0.1.5-mac-x64.dmg`](https://github.com/yanwith7/rj-piggy-bank/releases/download/v0.1.5/RJ-Piggy-Bank-0.1.5-mac-x64.dmg) |
| Windows 10 / 11，绝大多数 Intel / AMD 电脑 | [`RJ-Piggy-Bank-0.1.5-Windows-x64.exe`](https://github.com/yanwith7/rj-piggy-bank/releases/download/v0.1.5/RJ-Piggy-Bank-0.1.5-Windows-x64.exe) |
| Windows on ARM（如 Snapdragon） | [`RJ-Piggy-Bank-0.1.5-Windows-arm64.exe`](https://github.com/yanwith7/rj-piggy-bank/releases/download/v0.1.5/RJ-Piggy-Bank-0.1.5-Windows-arm64.exe) |

Windows：下载完成后直接双击 `.exe` 即可；无需解压。Mac：打开 `.dmg` 后将 App 拖进“应用程序”。无论选哪一种，首次启动都请把**数据目录**设在自己管理的本地文件夹中。卸载应用不会删除这个文件夹。

macOS 包在公开发布前需要 Apple Developer ID 签名和公证，才能完全避免 Gatekeeper 的首次打开提示；本项目的自动构建会做完整性校验，但不冒充 Apple 公证签名。

## 最重要的数据规则

- 第一次启动会选择一个**由你自己管理的本地文件夹**。资产数据不存浏览器缓存，也不放在安装包目录。
- 主数据文件为「窝头RJの存钱罐.json」；每次保存一笔快照时，会再生成「备份/YYYY-MM-DD_HHmmss.json」。
- 备份只保留最近 30 份。主数据无法读取时，应用会依次尝试最近的备份并明确提示恢复结果。
- 平台、产品和资产类型的变更立即原子写入磁盘；保存失败会在页面顶部红色提示，绝不会静默忽略。
- 更换数据目录时，应用会先复制主数据和备份到新目录，并**保留旧目录原件**作为额外安全副本。
- 卸载、重装或清理应用缓存不会删除你选定数据目录中的文件。重新安装后选择原来的数据文件夹即可继续使用。

建议：数据目录放在你平时备份的个人文件夹或加密磁盘中；每隔一段时间导出一次 JSON 到另一个磁盘。

## 功能

- 平台、产品、资产类型的新增、编辑、排序和归档
- 按平台分组的“记一笔”；自动带入上一条记录的金额
- 同日覆盖二次确认，保存快照后自动备份
- 净资产总览、类型和平台拆分、历史趋势与明细展开
- 平台 / 资产类型 / 流动性多维分析
- JSON 完整备份、Excel 兼容 CSV、包含总览和历史的 PDF
- 导入 JSON 前预览记录数、平台数、产品数与最新净资产
- 清空前强制备份并要求输入「确认清空」

## 本地开发

需要 Node.js 20 或更高版本。

    pnpm install
    pnpm start

如果 pnpm 提示 Electron 的构建脚本未获批准，请在项目目录执行：

    pnpm approve-builds

只选择 electron，然后确认。此步骤仅下载 Electron 的本地运行时；应用运行后仍不会联网。

## 打包

在 macOS 上生成 Apple Silicon 和 Intel 的 DMG / ZIP：

    pnpm run dist:mac

在 Windows 上生成 x64 / ARM64 的安装器和便携版：

    pnpm run dist:win

构建结果在 dist/。当前发布版已经提供 macOS（Apple 芯片 / Intel）和 Windows（x64 / ARM64）的四种直接下载附件。后续若需要用 GitHub Actions 自动构建，创建工作流时 GitHub CLI 需要额外具备 `workflow` 权限。macOS 当前会做临时 ad-hoc 签名，避免未签名应用显示“已损坏/被修改”；若要公开分发，仍建议使用 Apple Developer ID 签名并公证。Windows 对外分发也建议配置代码签名证书。

## 数据文件格式

主文件是 UTF-8 JSON，结构版本为 schemaVersion: 1，包含：

- assetTypes：资产类型（含颜色、资产 / 负债角色）
- platforms：平台
- products：产品，关联平台和资产类型
- snapshots：按日期保存的各产品金额
- metadata：创建、保存、导出时间

不要手动编辑正在被应用使用的主文件。若必须手工恢复，请先复制一份，再通过应用的“导入恢复”完成。
