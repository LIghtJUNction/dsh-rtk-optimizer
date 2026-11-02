# dsh-rtk-optimizer

压缩 DSH shell 工具的模型可见输出，并提供对本地 RTK CLI 的命令改写建议。没有外部付费服务。

## 安装

需要 Node.js 24+、DeepSeek Harness **0.2.1-rc.2**。只有命令建议功能需要自行安装 `rtk` 并放进 PATH；输出压缩不需要它。当前为源码交付，不表示 npm 已发布。

在已安装 monorepo 依赖的目录：

```sh
npm run check --workspace @lightjunction/dsh-rtk-optimizer
cd plugins/dsh-rtk-optimizer
npm pack
dsh plugin --profile web add "$PWD/lightjunction-dsh-rtk-optimizer-0.1.0.tgz" --ignore-scripts
```

重启目标 profile，确认 `rtk_rewrite`、`rtk_compact`、`rtk_stats`。其他 profile 替换 `web`。

## 行为和示例

默认监听 `bash`、`shell` 的 `tools/post-execute`。rc.2 官方 `dsh-tool-bash` 注册的工具名是 **bash**。插件去掉 ANSI 控制序列，聚合逐条成功测试行及连续重复普通输出，只采用确实减少 UTF-8 字节数的结果；不截断输出。不去掉失败、错误、警告和退出状态标记。不处理 read/edit/hashline 工具或基础设施失败结果。

仅修改模型可见 content，保留工具 schema 验证后的 canonical value、stdout/stderr 和退出状态。PTC 程序拿到的 value 不会减少；这不是对原始日志、账单或精确 token 的压缩。非零 bash 退出码可能仍是 isError:false，失败文本和退出标记会保留。其他 post-policy 的 block 或 value 替换得到尊重。

调用 `rtk_rewrite`：

```json
{"command":"git status"}
```

它使用参数数组执行 `rtk rewrite <完整命令字符串>`，**不会执行建议的 shell 命令**。返回 command、rewritten、available、reason。RTK 缺失时保留原命令并返回 available:false；rewrite 阶段有 3 秒进程上限，支持取消，限制输出大小。上游支持的 rewrite 退出码 0/3 被识别为成功，1 表示无需改写。

调用 `rtk_compact` 可以显式压缩已有终端输出：

```json
{"text":"<测试或构建终端输出>"}
```

最多 1 MiB。不应传入源码或编辑锚点。`rtk_stats` 参数是 `{}`，返回本插件实例生命周期内自动处理的文本块数量和原始/输出字节量。它不是按 session 隔离的持久统计；多个文本块分别计数，也不代表调用次数。

## 配置

支持 root（宿主绝对工作区路径）、executable（RTK 可执行文件路径）、auto（默认 true）、toolNames（默认 bash/shell）。root 默认来自当前 agent workingDirectory；无 agent 调用 rtk_rewrite 必须设置 root。auto:false 关闭自动 content 转换但保留三个工具。toolNames:[] 明确不监听任何工具。

本地 RTK 进程只使用宿主文件系统，不接入 DSH remote world/sandbox，不是沙箱命令执行器。压缩规则是有损文本投影，canonical value 保留原始输出；禁用 auto 可用于精确终端证据采集。其他工具的 finalizeContent 仍可能再次覆盖 content，本插件不能保证任意第三方插件组合。

## v0.1 与 pi 来源的差异

来源为 [MasuRii/pi-rtk-optimizer](https://github.com/MasuRii/pi-rtk-optimizer)，MIT，详见 [UPSTREAM.md](UPSTREAM.md)、[NOTICE](NOTICE)。这是独立 DSH 实现，没有复制上游实现源码。

rc.2 调用参数不可变，因此首版不自动改写已经派发的 bash 命令，改为显式 rtk_rewrite 建议。只包含 ANSI、成功测试行和连续重复行处理，不具备上游全部构建/lint/Git 语义过滤、源码过滤、TUI 设置或截断策略。不替代 dsh context pruner。

## 本地验证

```sh
npm run check --workspace @lightjunction/dsh-rtk-optimizer
```

真实 rc.2 ToolRuntime 测试覆盖 schema、自动 content 投影、canonical value 保留、hashline 排除、post-policy block、缺失 RTK、参数传递、不执行建议命令和取消。rewrite 退出码测试使用本地确定性 CLI fixture；不要求 CI 已安装 RTK。
