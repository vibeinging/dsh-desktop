# DSH 附件输入插件选择与内置审查

## 结论

新 Profile 默认内置社区插件 `dsh-multimedia-webui-input@0.1.0`。它是独立 DSH Profile Bundle，Host 和 Client 都通过公开 DSH 接口工作：Host 注册同源上传路由，Client 注册 `conversation.input.left`、`conversation.input.dock`、`conversation.input.overlay` 和 `settings.section`。内置版提供图片、文件和文件夹选择、发送前附件条和清理入口，不修改官方 Chat，也不依赖 Electron 通用 IPC。图片进入官方原生图片附件通道；文件和文件夹进入 Session 工作区。

## GitHub 搜索结果

| 候选 | 能力 | 结论 |
| --- | --- | --- |
| [LCYLYM/dsh-attachments](https://github.com/LCYLYM/dsh-attachments) | 官方输入 Slot 中的文件/文件夹选择、拖拽和 Session 工作区交付 | 选中。公开 npm 包、MIT、双面 Bundle、零运行依赖 |
| [deepseek-ai/deepseek-harness `ui-attachment`](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/ui-attachment) | 官方草稿图片缩略图、移除、历史图片和大图预览 | 直接复用。它已经随官方 Web 提供，不需要另装社区插件 |
| [HongMing-Huang/dsh-file-upload](https://github.com/HongMing-Huang/dsh-file-upload) | 文件卡片、文档转换、OCR、语音和图片处理 | 不默认。能力重、依赖和权限面更大，并会与当前纸夹、拖拽和粘贴入口重叠 |
| [sprainJinyu/dsh-vision-link](https://github.com/sprainJinyu/dsh-vision-link) | 保留官方图片缩略图，为文本模型桥接视觉模型 | 不默认。它不是文件选择插件，当前内置视觉模型无需该桥接 |
| [lhh010/dsh-paste-input](https://github.com/lhh010/dsh-paste-input) | 在前一候选上增加粘贴提示和发送后气泡折叠 | 暂不默认。功能重叠，且同时启用会重复注册附件入口 |
| [No-PRM/dsh-explorer](https://github.com/No-PRM/dsh-explorer) | 文件树、预览、Git 状态和拖入引用 | 不替代附件按钮；属于工作区浏览器，可由用户从市场另装 |
| [Lings01/dsh-filepanel-plugin](https://github.com/Lings01/dsh-filepanel-plugin) | 文件面板、上传、编辑、搜索和压缩 | 权限面更大，功能定位不是输入框附件入口，不进入默认 Profile |
| [ccq1/dsh-side-panel](https://github.com/ccq1/dsh-side-panel) | 文件、终端和 Git 侧栏 | 已归档，上游推荐 Better Sidebar，不作为发行候选 |

## 固定来源

- npm：`dsh-multimedia-webui-input@0.1.0`
- npm 完整性：`sha512-p79qgcvquYISotp4tU8ddnDuY3TBth8lG1Mwa6d5U74GCOrRA/jQpX724yar4SyBE4Dfiit2O2bN+Q+TSxBSHw==`
- 上游提交：`028dc1f8dc9c7f963e714013b36adc4f48d88c2a`
- npm tarball SHA-256：`73c53381e1259c08002c78991d2c35590593865eba6a39aba1e31a320a056727`
- npm tarball 大小：`5,234,475` bytes，其中包含不参与运行的演示 GIF 和本地安装器
- 发行 tarball：只保留 `lib`、`cordis.patch.yml`、中英文 README 和 `LICENSE`，并应用下述固定冲突适配；当前生成大小 `19,821` bytes，SHA-256 为 `d9cb009f3814646e6962a2f1875d0885c948d39a9a549fb13909056a0bcf070f`
- 许可证：MIT；随包 `LICENSE` SHA-256 为 `008d11ebaf44cc7b185137aad7e6b22eaacf7992d66440b19a8ee82f3e73095d`
- 运行依赖、原生依赖和 npm 安装脚本：无

## 权限和数据边界

浏览器只读取用户主动选择的 `File`。真正发送时，插件通过同源路由把文件流式写入当前 live Session 的工作区：`<cwd>/.dsh/tmp/attachments/<session>/<send>/`。清理操作需要用户再次确认，并只删除带插件所有权标记的已提交目录。未知目录、其他工作区和未授权路径不在清理范围内。

官方 DSH rc.2 已经负责图片粘贴、拖拽和 `AttachmentRail` 缩略图。上游插件也注册通用文件拖拽，两者同时运行时图片可能进入两条通道。发行生成器因此对固定的 `lib/client.js` 应用 `smart-attachment-picker-v3`：源文件 SHA-256 必须是 `80664dc90259b6312ac86259c5a3ccdacbc3b7674600e37f42404aeccc7834f4`，适配后必须是 `a58603195621475c7589a398b3854c05e1c3a9b535adf5691d7f04f5dd7720e7`，否则停止生成。适配删除上游 document 级 drag/drop effect，并让单一文件选择入口按官方 `imageLimits.mediaTypes` 自动分流；图片通过标准 `File`、`DataTransfer` 和 `DragEvent` 进入官方缩略图轨道，普通文件进入 Session 工作区。文件夹选择、发送引用、设置和清理保持不变。

插件不调用 DSH Desktop 的 Electron 文件对话框 Host。它使用浏览器标准文件输入，因此官方 DSH Web、DSH Desktop 和远程 Web 都能采用同一个 Bundle。浏览器不会提供任意本地绝对路径。图片由官方附件服务编码为原生 image block；普通文件复制到 Session 工作区后由模型通过普通 DSH 文件工具读取。

## 组合和冲突

该插件与 `@dsh-community/dsh-paste-input`、`dsh-universal-attachments`、`dsh-file-attachments` 等附件输入插件功能重叠。同时启用可能出现重复按钮、重复引用或重复上传。默认 Profile 只内置 `dsh-multimedia-webui-input`；用户若选择其他附件插件，应先通过官方 `dsh plugin --profile web remove dsh-multimedia-webui-input` 卸载默认插件。

## 发行验收

固定包必须进入 `server/package-lock.json` 和唯一精选清单，由生成器封装为离线 tarball 并保留许可证。回归至少覆盖：精确版本和完整性漂移拒绝、零依赖闭包、官方 Profile 安装、官方输入 Slot 中附件按钮可见、一次混合文件选择把图片送入官方缩略图而不生成工作区图片卡片、把普通文件送入工作区卡片、停用、官方卸载和卸载后重启恢复。静态或源码检查不能替代真实打包 Electron 的 Client 激活证据。
