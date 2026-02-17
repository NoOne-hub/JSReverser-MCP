<!-- AUTO GENERATED DO NOT EDIT - run 'npm run docs' to update-->

# Chrome DevTools MCP Tool Reference

> 快速按逆向目标查工具，请先看：[`docs/reverse-task-index.md`](./reverse-task-index.md)

- **[Navigation automation](#navigation-automation)** (13 tools)
  - [`click_element`](#click_element)
  - [`find_clickable_elements`](#find_clickable_elements)
  - [`get_dom_structure`](#get_dom_structure)
  - [`get_performance_metrics`](#get_performance_metrics)
  - [`list_pages`](#list_pages)
  - [`navigate_page`](#navigate_page)
  - [`navigate_page`](#navigate_page)
  - [`new_page`](#new_page)
  - [`query_dom`](#query_dom)
  - [`select_page`](#select_page)
  - [`take_screenshot`](#take_screenshot)
  - [`type_text`](#type_text)
  - [`wait_for_element`](#wait_for_element)
- **[Network](#network)** (6 tools)
  - [`analyze_websocket_messages`](#analyze_websocket_messages)
  - [`get_network_request`](#get_network_request)
  - [`get_websocket_message`](#get_websocket_message)
  - [`get_websocket_messages`](#get_websocket_messages)
  - [`list_network_requests`](#list_network_requests)
  - [`list_websocket_connections`](#list_websocket_connections)
- **[Debugging](#debugging)** (4 tools)
  - [`evaluate_script`](#evaluate_script)
  - [`get_console_message`](#get_console_message)
  - [`list_console_messages`](#list_console_messages)
  - [`take_screenshot`](#take_screenshot)
- **[JS Reverse Engineering](#js-reverse-engineering)** (45 tools)
  - [`analyze_target`](#analyze_target)
  - [`break_on_xhr`](#break_on_xhr)
  - [`collect_code`](#collect_code)
  - [`collection_diff`](#collection_diff)
  - [`create_hook`](#create_hook)
  - [`deobfuscate_code`](#deobfuscate_code)
  - [`detect_crypto`](#detect_crypto)
  - [`evaluate_on_callframe`](#evaluate_on_callframe)
  - [`export_session_report`](#export_session_report)
  - [`find_in_script`](#find_in_script)
  - [`get_hook_data`](#get_hook_data)
  - [`get_paused_info`](#get_paused_info)
  - [`get_request_initiator`](#get_request_initiator)
  - [`get_script_source`](#get_script_source)
  - [`get_storage`](#get_storage)
  - [`hook_function`](#hook_function)
  - [`inject_hook`](#inject_hook)
  - [`inject_stealth`](#inject_stealth)
  - [`inspect_object`](#inspect_object)
  - [`list_breakpoints`](#list_breakpoints)
  - [`list_hooks`](#list_hooks)
  - [`list_hooks`](#list_hooks)
  - [`list_scripts`](#list_scripts)
  - [`list_stealth_features`](#list_stealth_features)
  - [`list_stealth_presets`](#list_stealth_presets)
  - [`monitor_events`](#monitor_events)
  - [`pause`](#pause)
  - [`remove_breakpoint`](#remove_breakpoint)
  - [`remove_hook`](#remove_hook)
  - [`remove_xhr_breakpoint`](#remove_xhr_breakpoint)
  - [`resume`](#resume)
  - [`risk_panel`](#risk_panel)
  - [`search_in_scripts`](#search_in_scripts)
  - [`search_in_sources`](#search_in_sources)
  - [`set_breakpoint`](#set_breakpoint)
  - [`set_breakpoint_on_text`](#set_breakpoint_on_text)
  - [`set_user_agent`](#set_user_agent)
  - [`step_into`](#step_into)
  - [`step_out`](#step_out)
  - [`step_over`](#step_over)
  - [`stop_monitor`](#stop_monitor)
  - [`summarize_code`](#summarize_code)
  - [`trace_function`](#trace_function)
  - [`understand_code`](#understand_code)
  - [`unhook_function`](#unhook_function)

## Navigation automation

### `click_element`

**Description:** Click an element by selector.

**Parameters:**

- `selector`

### `find_clickable_elements`

**Description:** Find clickable buttons/links, optionally filtered by text.

**Parameters:**

- `filterText`

### `get_dom_structure`

**Description:** Get DOM tree structure for current page.

**Parameters:**

- `maxDepth`
- `includeText`

### `get_performance_metrics`

**Description:** Get page performance metrics from Performance API.

### `list_pages`

**Description:** Get a list of pages open in the browser.

### `navigate_page`

**Description:** Navigates the currently selected page to a URL, or performs back/forward/reload navigation. Waits for DOMContentLoaded event (not full page load). Default timeout is 10 seconds.

**Parameters:**

- `type`
- `url`
- `ignoreCache`
- `timeout`

### `navigate_page`

**Description:** Navigate current page to a URL.

**Parameters:**

- `url`
- `timeout`

### `new_page`

**Description:** Creates a new page and navigates to the specified URL. Waits for DOMContentLoaded event (not full page load). Default timeout is 10 seconds.

**Parameters:**

- `url`
- `timeout`

### `query_dom`

**Description:** Query one or multiple elements by CSS selector.

**Parameters:**

- `selector`
- `all`
- `limit`

### `select_page`

**Description:** Select a page as a context for future tool calls.

**Parameters:**

- `pageIdx`

### `take_screenshot`

**Description:** Take screenshot of current page.

**Parameters:**

- `path`
- `fullPage`
- `type`

### `type_text`

**Description:** Type text into an input element.

**Parameters:**

- `selector`
- `text`
- `delay`

### `wait_for_element`

**Description:** Wait for selector to appear.

**Parameters:**

- `selector`
- `timeout`

## Network

### `analyze_websocket_messages`

**Description:** Analyzes WebSocket messages and groups them by pattern/fingerprint. Essential for understanding binary/protobuf message types in live streaming scenarios. Returns statistics and sample indices for each message type.

**Parameters:**

- `wsid`
- `direction`

### `get_network_request`

**Description:** Gets a network request by an optional reqid, if omitted returns the currently selected request in the DevTools Network panel.

**Parameters:**

- `reqid`

### `get_websocket_message`

**Description:** Gets a single WebSocket message by its frame index. Use get_websocket_messages or analyze_websocket_messages first to find the frame index.

**Parameters:**

- `wsid`
- `frameIndex`

### `get_websocket_messages`

**Description:** Gets messages for a WebSocket connection. IMPORTANT: For binary/protobuf messages (like live streaming), use analyze_websocket_messages FIRST to understand message types, then use groupId parameter to filter specific types. Default mode shows summary only.

**Parameters:**

- `wsid`
- `direction`
- `groupId`
- `pageSize`
- `pageIdx`
- `show_content`

### `list_network_requests`

**Description:** List all requests for the currently selected page since the last navigation.

**Parameters:**

- `pageSize`
- `pageIdx`
- `resourceTypes`
- `includePreservedRequests`

### `list_websocket_connections`

**Description:** List all WebSocket connections. After getting wsid, use analyze_websocket_messages(wsid) FIRST to understand message patterns before viewing individual messages.

**Parameters:**

- `pageSize`
- `pageIdx`
- `urlFilter`
- `includePreservedConnections`

## Debugging

### `evaluate_script`

**Description:** Evaluate a JavaScript function inside the currently selected page. Returns the response as JSON
so returned values have to JSON-serializable.

**Parameters:**

- `function`

### `get_console_message`

**Description:** Gets a console message by its ID. You can get all messages by calling list_console_messages.

**Parameters:**

- `msgid`

### `list_console_messages`

**Description:** List all console messages for the currently selected page since the last navigation.

**Parameters:**

- `pageSize`
- `pageIdx`
- `types`
- `includePreservedMessages`

### `take_screenshot`

**Description:** Take a screenshot of the page or element.

**Parameters:**

- `format`
- `quality`
- `fullPage`
- `filePath`

## JS Reverse Engineering

### `analyze_target`

**Description:** One-shot reverse workflow: collect code, run security/crypto analysis, optional deobfuscation, and hook timeline correlation.

**Parameters:**

- `url`
- `topN`
- `useAI`
- `runDeobfuscation`
- `hookPreset`
- `autoInjectHooks`
- `waitAfterHookMs`
- `correlationWindowMs`
- `maxCorrelatedFlows`
- `maxFingerprints`
- `collect`

### `break_on_xhr`

**Description:** Sets a breakpoint that triggers when an XHR/Fetch request URL contains the specified string.

**Parameters:**

- `url`

### `collect_code`

**Description:** Collect JavaScript code from a page with smart modes (summary/priority/incremental/full).

**Parameters:**

- `url`
- `smartMode`
- `returnMode`
- `includeInline`
- `includeExternal`
- `includeDynamic`
- `maxTotalSize`
- `maxFileSize`
- `pattern`
- `limit`
- `topN`

### `collection_diff`

**Description:** Compare previous and current collected file summaries.

**Parameters:**

- `previous`
- `current`
- `includeUnchanged`

### `create_hook`

**Description:** Create hook script for function/fetch/xhr/property/cookie/websocket/eval/timer.

**Parameters:**

- `type`
- `params`
- `description`
- `action`

### `deobfuscate_code`

**Description:** AI-assisted JavaScript deobfuscation.

**Parameters:**

- `code`
- `aggressive`
- `renameVariables`

### `detect_crypto`

**Description:** Detect cryptographic algorithms/libraries from JavaScript source.

**Parameters:**

- `code`
- `useAI`

### `evaluate_on_callframe`

**Description:** Evaluates a JavaScript expression in the context of a specific call frame while paused. This allows you to inspect variables and execute code in the paused scope.

**Parameters:**

- `expression`
- `frameIndex`

### `export_session_report`

**Description:** Export current reverse-engineering session as JSON or Markdown.

**Parameters:**

- `format`
- `includeHookData`

### `find_in_script`

**Description:** Finds a string in a specific script and returns its exact line/column position with surrounding context. Ideal for setting breakpoints in minified files where the entire code is on one line.

**Parameters:**

- `scriptId`
- `query`
- `contextChars`
- `occurrence`
- `caseSensitive`

### `get_hook_data`

**Description:** Get captured data for one hook or all hooks.

**Parameters:**

- `hookId`

### `get_paused_info`

**Description:** Gets information about the current paused state including call stack, current location, and scope variables. Use this after a breakpoint is hit to understand the execution context.

**Parameters:**

- `includeScopes`
- `maxScopeDepth`

### `get_request_initiator`

**Description:** Gets the JavaScript call stack that initiated a network request. This helps trace which code triggered an API call.

**Parameters:**

- `requestId`

### `get_script_source`

**Description:** Gets the source code of a JavaScript script by its script ID. Supports line range (for normal files) or character offset (for minified single-line files). Use list_scripts first to find the script ID.

**Parameters:**

- `scriptId`
- `startLine`
- `endLine`
- `offset`
- `length`

### `get_storage`

**Description:** Gets browser storage data including cookies, localStorage, and sessionStorage.

**Parameters:**

- `type`
- `filter`

### `hook_function`

**Description:** Hooks a JavaScript function to log its calls, arguments, and return values. Useful for understanding how functions are used without setting breakpoints.

**Parameters:**

- `target`
- `logArgs`
- `logResult`
- `logStack`
- `hookId`

### `inject_hook`

**Description:** Inject an existing hook into the current page.

**Parameters:**

- `hookId`

### `inject_stealth`

**Description:** Inject anti-detection stealth scripts to current page.

**Parameters:**

- `preset`

### `inspect_object`

**Description:** Deeply inspects a JavaScript object, showing its properties, prototype chain, and methods. Useful for understanding object structure.

**Parameters:**

- `expression`
- `depth`
- `showMethods`
- `showPrototype`

### `list_breakpoints`

**Description:** Lists all active breakpoints in the current debugging session.

### `list_hooks`

**Description:** Lists all active function hooks.

### `list_hooks`

**Description:** List all created hooks and statuses.

### `list_scripts`

**Description:** Lists all JavaScript scripts loaded in the current page. Returns script ID, URL, and source map information. Use this to find scripts before setting breakpoints or searching.

**Parameters:**

- `filter`

### `list_stealth_features`

**Description:** List available stealth feature toggles.

### `list_stealth_presets`

**Description:** List available stealth presets.

### `monitor_events`

**Description:** Monitors DOM events on a specified element or window. Events will be logged to console.

**Parameters:**

- `selector`
- `events`
- `monitorId`

### `pause`

**Description:** Pauses JavaScript execution at the current point. Use this to interrupt running code.

### `remove_breakpoint`

**Description:** Removes a breakpoint by its ID. Use list_breakpoints to see active breakpoints.

**Parameters:**

- `breakpointId`

### `remove_hook`

**Description:** Remove a hook by id.

**Parameters:**

- `hookId`

### `remove_xhr_breakpoint`

**Description:** Removes an XHR/Fetch breakpoint.

**Parameters:**

- `url`

### `resume`

**Description:** Resumes JavaScript execution after being paused at a breakpoint. Execution continues until the next breakpoint or completion.

### `risk_panel`

**Description:** Build a combined risk score from analyzer, crypto detector and hook signals.

**Parameters:**

- `code`
- `useAI`
- `includeHookSignals`
- `hookId`
- `topN`

### `search_in_scripts`

**Description:** Search in collected script cache with regex pattern.

**Parameters:**

- `pattern`
- `limit`
- `maxTotalSize`

### `search_in_sources`

**Description:** Searches for a string or regex pattern in all loaded JavaScript sources. Returns matching lines with script ID, URL, and line number. Use get_script_source with startLine/endLine to view full context around matches.

**Parameters:**

- `query`
- `caseSensitive`
- `isRegex`
- `maxResults`
- `maxLineLength`
- `excludeMinified`
- `urlFilter`

### `set_breakpoint`

**Description:** Sets a breakpoint in a JavaScript file at the specified line. The breakpoint will trigger when the code executes.

**Parameters:**

- `url`
- `lineNumber`
- `columnNumber`
- `condition`
- `isRegex`

### `set_breakpoint_on_text`

**Description:** Sets a breakpoint on specific code (function name, statement, etc.) by searching for it and automatically determining the exact position. Works with both normal and minified files.

**Parameters:**

- `text`
- `urlFilter`
- `occurrence`
- `condition`

### `set_user_agent`

**Description:** Set custom user-agent for active page.

**Parameters:**

- `userAgent`

### `step_into`

**Description:** Steps into the next function call. Use this to enter and debug function bodies.

### `step_out`

**Description:** Steps out of the current function, continuing until the function returns. Use this to quickly exit a function.

### `step_over`

**Description:** Steps over to the next statement, treating function calls as a single step. Use this to move through code without entering function bodies.

### `stop_monitor`

**Description:** Stops an event monitor.

**Parameters:**

- `monitorId`

### `summarize_code`

**Description:** Summarize one code file, multiple files, or project-level context.

**Parameters:**

- `mode`
- `code`
- `url`
- `files`

### `trace_function`

**Description:** Traces calls to a function by its name in the source code. Works for ANY function including module-internal functions (webpack/rollup bundled). Uses "logpoints" (conditional breakpoints) to log arguments without pausing execution.

**Parameters:**

- `functionName`
- `urlFilter`
- `logArgs`
- `logThis`
- `pause`
- `traceId`

### `understand_code`

**Description:** Analyze code structure/business/security with AI + static analysis.

**Parameters:**

- `code`
- `focus`

### `unhook_function`

**Description:** Removes a previously installed function hook.

**Parameters:**

- `hookId`
