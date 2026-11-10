# dsh-archive-mgr

DeepSeek Harness 归档会话清理插件：**把已归档的会话真正删掉**（先进本地回收站，可还原），也可以取消归档、清空回收站。

DSH 官方的「归档」只是把会话从侧栏隐藏，日志永远留在磁盘上；本插件补上删除这一环。

## 安装

三种方式，任选其一：

```sh
# 1) 本地目录（开发/试用）
dsh plugin --profile desktop add ./dsh-archive-mgr

# 2) 打包后的 tarball（分发）
dsh plugin --profile desktop add ./dsh-archive-mgr-0.2.1.tgz

# 3) GitHub 源码（本插件零构建，纯 JS，装完即可用）
dsh plugin --profile desktop add github:<you>/dsh-archive-mgr
```

桌面版也可以直接让 DSH 的插件管理器安装本地目录或 tarball（`dsh plugin add` 与「设置 → 插件」走同一套 pnpm + profile 注册）。
装完刷新页面（必要时重启 DSH）生效。

## 使用

右下角出现一个 🗑 按钮，点开分两个页签：

**归档**
- 列出所有已归档会话，按创建时间倒序，显示标题、工作区路径、创建时间、占用大小
- **恢复**：取消归档，会话立刻回到侧栏原工作区（不动文件）
- **删除**：二次确认后把会话日志移入本地回收站，并从归档列表移除

删除会同步清理界面的会话目录：宿主把已删除的会话从内存中的会话表里摘除，并广播 `api-session/removed`，所以侧栏里的那一行会立即消失，**不需要重启软件**。从回收站还原后会重新拉取一次会话列表，会话立刻回到侧栏。

**回收站**
- **还原**：文件归位并自动取消归档，会话回到侧栏
- **彻底删除**：从磁盘永久删除，不可恢复
- **清空回收站**：一次清掉全部条目

## 数据位置

| 内容 | 路径 |
|---|---|
| 会话日志 | `$DSH_HOME/sessions/<工作区编码>/<会话ID>/session.v4.jsonl.zstd` |
| 投影缓存 | `$DSH_HOME/storages/session_projcache/sessions/<会话ID>.json` |
| 回收站 | `$DSH_HOME/archive-mgr/trash/<时间戳>-<会话ID>/`（含 `session/`、`projection.json`、`meta.json`） |
| 归档标记 | `$DSH_HOME/storages/workspace.json` 的 `global.archivedSessionIds` |

`$DSH_HOME` 默认是 `~/.dsh`，可用环境变量覆盖。

## 安全边界

- 只处理**已归档**的会话：未归档的会话不出现在列表里，本插件也删不到。
- 删除是「移入回收站」，不是直接抹盘；只有「彻底删除 / 清空」才会真正移除文件。
- 会话状态变更走 `workspaceRegistry` 的串行队列（`enqueueOperation` → `requireState` → `setState`），与原生归档同一把锁；状态写失败时会把文件回滚回原位。
- 宿主服务（`workspaceRegistry` / `sessionQuery` / `webServer`）任一缺失即降级（fail-open），不影响原生归档。
- 启动时清理两类残留：归档标记指向已不存在的会话（ghost id）、以及会话已删除却残留的投影缓存。

## 卸载

```sh
dsh plugin --profile desktop remove dsh-archive-mgr
```

回收站目录 `$DSH_HOME/archive-mgr/` 会保留，可自行删除；卸载不会删除任何会话。

## 兼容性

- 目标 DSH `0.1.x / 0.2.x`（Web / Desktop profile）。
- 只依赖三个公开宿主服务：`workspaceRegistry`（`archivedSessionIds`、`enqueueOperation` / `requireState` / `setState` / `list`）、`sessionQuery`（`listSessions` / `readTitleSnapshots`）、`webServer`（`register`）。
- 客户端只用一个 `locale` 服务做中英文切换，不依赖 React、主题或插槽。
- 任一依赖缺失即降级（fail-open），不会阻塞原生归档。

## 发布

```sh
npm publish          # 已用 files 白名单，只发布 src/lib/cordis.patch.yml/README/LICENSE
```

或打成 tarball 分发：`npm pack`（产物 `dsh-archive-mgr-0.2.1.tgz`）。

## 更新日志

### 0.2.1
- 修复：删除归档会话后，该会话仍留在侧栏工作区列表里、必须重启 DSH 才消失。
  宿主现在会在删除成功后把会话从内存会话表中摘除（若是活动会话），并广播
  `api-session/removed`，客户端会话目录即时收敛；回收站还原后也会主动刷新会话列表。
- 删除接口新增 `catalogRemoved` 回执，客户端据此决定是否需要重新拉取列表，避免
  活动会话残留行被刷新重新带回。

### 0.2.0
- 包名改为 `dsh-archive-mgr`；插件卸载后路由立即失效。

## 开发

```sh
npm test              # 等价于 node test/smoke.mjs
```

结构：

```
src/index.js      宿主插件：列表 / 删除 / 还原 / 彻底删除 / 清空 / 启动核对（HTTP API /dsh-archive-mgr/api/*）
lib/client.js     客户端插件：右下角入口 + 面板 + 确认框（ModuleLoader 格式，无需构建）
cordis.patch.yml  组合包 patch：插入 archive-mgr 这一行
test/smoke.mjs    路由 + 文件移动 + 状态串行化的断言测试
```
