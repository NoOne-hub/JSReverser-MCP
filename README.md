# JS Reverse MCP

一个面向 **JavaScript 逆向分析** 的 MCP 服务器。  
让 Claude/Codex/Cursor 等 AI 客户端直接调用浏览器调试能力，完成脚本定位、断点调试、Hook 采样、网络链路分析、混淆还原和风险评估。

## 这个项目解决什么问题

在传统逆向流程里，你通常要在 DevTools、脚本文件、抓包工具之间来回切换。  
`js-reverse-mcp` 把这些能力统一成 MCP 工具，让 AI 可以按步骤执行完整分析链路：

1. 打开页面并收集脚本
2. 搜索目标函数/关键字符串
3. 自动注入 Hook 并采样请求
4. 分析签名链路、加密算法、调用栈
5. 输出可执行的下一步动作（而不是只给概念）

## 核心能力

- 脚本与源码分析：`list_scripts`、`get_script_source`、`find_in_script`、`search_in_scripts`
- 断点与执行控制：`set_breakpoint`、`set_breakpoint_on_text`、`resume`、`pause`、`step_over/into/out`
- Hook 与运行时观测：`create_hook`、`inject_hook`、`get_hook_data`、`hook_function`、`trace_function`
- 网络与请求链路：`list_network_requests`、`get_network_request`、`get_request_initiator`、`break_on_xhr`
- 一体化逆向工作流：`analyze_target`、`collect_code`、`understand_code`、`deobfuscate_code`、`risk_panel`
- 页面自动化与 DOM：`navigate_page`、`query_dom`、`click_element`、`type_text`、`take_screenshot`
- 登录态管理：`save_session_state`、`restore_session_state`、`list_session_states`、`dump_session_state`、`load_session_state`
- 反检测能力：`inject_stealth`、`list_stealth_presets`、`set_user_agent`

完整参数说明见 `docs/tool-reference.md`。

## 快速开始（3 分钟）

### 1) 安装依赖并构建

```bash
npm install
npm run build
```

构建完成后入口文件为：`build/src/index.js`

### 2) 本地启动（可选）

```bash
npm run start
```

### 3) 配置 MCP 客户端

通用 MCP 客户端（如支持 JSON 的客户端）配置如下：

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/js-reverse-mcp-main/build/src/index.js"]
    }
  }
}
```

请使用**绝对路径**，避免客户端工作目录变化导致找不到入口文件。

### 4) 连接“已开启”的 Chrome（远程调试）

如果你已经在本机开了一个 Chrome，并希望 MCP 直接接管它，请按下面做。

#### 4.1 启动 Chrome 并打开 remote debugging

Windows:

```bash
"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\\tmp\\chrome-mcp"
```

macOS:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-mcp
```

Linux:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-mcp
```

#### 4.2 在 MCP 里连接这个浏览器（两种方式）

方式 A: 通过 `browserUrl`（最简单）

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/js-reverse-mcp-main/build/src/index.js",
        "--browserUrl",
        "http://127.0.0.1:9222"
      ]
    }
  }
}
```

方式 B: 通过 `wsEndpoint`（更精确）

1. 先取 WS 地址：

```bash
curl http://127.0.0.1:9222/json/version
```

2. 读取返回里的 `webSocketDebuggerUrl`，再放进 MCP:

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/js-reverse-mcp-main/build/src/index.js",
        "--wsEndpoint",
        "ws://127.0.0.1:9222/devtools/browser/<id>"
      ]
    }
  }
}
```

注意：

- `--browserUrl` 与 `--wsEndpoint` 二选一，不要同时配置
- 如果端口不是 `9222`，把所有示例里的端口替换成你的实际端口
- 已连接远程 Chrome 时，不要再强制本服务自行启动另一个浏览器实例

## 常见客户端接入

### Claude Code

```bash
claude mcp add js-reverse node /ABSOLUTE/PATH/js-reverse-mcp-main/build/src/index.js
```

### Cursor

`Settings -> MCP -> New MCP Server`，填入：

- Command: `node`
- Args: `[/ABSOLUTE/PATH/js-reverse-mcp-main/build/src/index.js]`

### Codex

Codex 使用 `config.toml`，不是 JSON。可在 `~/.codex/config.toml` 中配置：

```toml
[mcp_servers.js-reverse]
command = "node"
args = ["/ABSOLUTE/PATH/js-reverse-mcp-main/build/src/index.js"]
```

如需连接已开启的 Chrome，可在 `args` 里追加：

```toml
[mcp_servers.js-reverse]
command = "node"
args = [
  "/ABSOLUTE/PATH/js-reverse-mcp-main/build/src/index.js",
  "--browserUrl",
  "http://127.0.0.1:9222"
]
```

客户端接入说明统一维护在本 README，不再单独拆分到 `docs`。

## 环境变量配置

复制示例配置：

```bash
cp .env.example .env
```

### AI Provider（可选）

```bash
# openai | anthropic | gemini
DEFAULT_LLM_PROVIDER=gemini

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://api.anthropic.com  # optional, for proxy/custom endpoint
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# Gemini
GEMINI_API_KEY=...
GEMINI_CLI_PATH=gemini-cli
GEMINI_MODEL=gemini-2.0-flash-exp
```

说明：

- 不配置 AI 也可使用非 AI 工具（调试/Hook/网络/页面控制）
- 配置 AI 后可用 `understand_code`、`deobfuscate_code`、`risk_panel` 等增强能力

### 浏览器与远程调试（可选）

```bash
BROWSER_HEADLESS=true
BROWSER_ISOLATED=true
BROWSER_EXECUTABLE_PATH=/path/to/chrome
BROWSER_CHANNEL=chrome
USE_STEALTH_SCRIPTS=false

REMOTE_DEBUGGING_URL=http://localhost:9222
REMOTE_DEBUGGING_PORT=9222
```

### 调试日志（可选）

```bash
DEBUG=mcp:*
```

## 推荐逆向工作流

### 工作流 A：快速定位签名逻辑

1. `new_page` 打开目标站点
2. `analyze_target` 一键执行采集+分析+关联
3. 查看 `priorityTargets` / `requestFingerprints`
4. 对高优先级函数调用 `search_in_scripts` + `understand_code`
5. 对可疑代码执行 `deobfuscate_code`

### 工作流 B：请求参数动态追踪

1. `create_hook` + `inject_hook`（`fetch/xhr/websocket`）
2. 在页面触发下单/登录等关键动作
3. `get_hook_data` 拉取记录并对比参数变化
4. 必要时 `break_on_xhr` + `get_request_initiator` 看调用栈

### 工作流 C：风险评估与报告

1. `collect_code` 收集高优先级脚本
2. `risk_panel` 汇总安全风险与密码学风险
3. `export_session_report` 导出分析报告（JSON/Markdown）

### 工作流 D：登录态复用（登录一次，多次分析）

1. 手动登录目标网站后执行 `save_session_state`（建议指定 `sessionId`）
2. 用 `dump_session_state` 导出到文件（可放在你自己的安全目录）
3. 下次会话先 `load_session_state`（从文件或 JSON）
4. 执行 `restore_session_state` 回灌 cookies/storage
5. 用 `check_browser_health` 确认页面可控后继续 `analyze_target`

## 开发与测试

```bash
# 构建
npm run build

# 单元测试
npm run test:unit

# 属性测试
npm run test:property

# 覆盖率（当前默认口径：核心 jshook + services）
npm run coverqge

# 全量覆盖率口径
npm run coverage:full
```

## 文档索引

- 逆向任务索引（按目标查工具）：`docs/reverse-task-index.md`
- 工具参数总表：`docs/tool-reference.md`
- JSHook 使用示例：`docs/jshook-examples.md`
- 常见问题排查：`docs/jshook-troubleshooting.md`
- Gemini Provider 说明：`docs/gemini-provider-implementation.md`

## 故障排查

- `Cannot find module ... build/src/index.js`
  - 先执行 `npm run build`
  - 确认文件存在：`build/src/index.js`
- Node 版本不兼容
  - 本项目要求：`^20.19.0 || ^22.12.0 || >=23`
- 浏览器连接失败
  - 检查 Chrome 可用性和 `REMOTE_DEBUGGING_URL/PORT`
- AI 调用失败
  - 检查 `DEFAULT_LLM_PROVIDER` 与对应 API Key/CLI 路径

## 参考项目

- https://github.com/wuji66dde/jshook-skill
- https://github.com/zhizhuodemao/js-reverse-mcp

## License

Apache-2.0
