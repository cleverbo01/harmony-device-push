# 鸿蒙设备信息推送工具

Windows 桌面通知转 MeoW 手机推送的小工具，附完整 C# / JavaScript 源码及 Python 调用示例，可阅读、DIY 修改和重新构建。

完整解压发行包，双击“鸿蒙设备信息推送工具.exe”，填写自己的 MeoW 设备 ID，保存并开始监控。runtime 内置 Node，无需另外安装。首次会生成自己的 config.json 和随机接口 token。

- Codex 共享服务：授权、等待答复、完成、失败、中断。
- Codex 桌面版/独立 CLI：本地记录完成/中断；无可订阅服务时授权不支持。
- DSH：v3/v4 日志授权及任务结束。
- DIY：本机 HTTP 接口，Node/Python 客户端和 Agent 接入模板。
- 推送开关：整类来源或单个任务，停止推送时仍保留任务显示。

文档入口：[使用文档](使用文档.md)、[开发文档](开发文档.md)、[接入接口说明](接入接口说明.md)、[Agent DIY 指南](agent-DIY接入指南.md)。

源码直接随运行文件提供，桌面程序.cs 是界面源码；*.mjs 是监听/推送源码，未混淆。构建.ps1 支持本机重新编译；tests.mjs、integration.test.mjs 提供测试。可直接修改 JavaScript 模块，修改 C# 后重新编译 EXE。

兼容基线：Windows 10/11 x64、.NET Framework 4.x、附带 Node 24.18.0。不同 Codex/DSH 版本接口可能变化，详见文档。发布包未含个人配置、任务记录或凭据。实际通知摘要通过 HTTPS 交给 api.chuckfang.com；公网服务及手机投递由该服务处理，API 排队成功不代表手机已显示。Node 及第三方许可在 runtime/LICENSE.txt。


## GitHub 发布

本文件夹包含当前确认的 UI、完整源码和编译 EXE。源码仓库上传本文件夹内的文件；.gitignore 排除个人配置、运行记录、备份和 runtime/node.exe。Node 运行时约 88 MiB，不提交到源码仓库，完整 ZIP 附在 GitHub Release。用户下载 Release 后完整解压即可双击使用；从源码仓库克隆后先运行 获取运行时.ps1，或自行安装兼容 Node，再使用 EXE。

界面最新消息自动截取到可用空间，留白选择不会影响监听，推送开关可以控制单个任务或整个来源。
