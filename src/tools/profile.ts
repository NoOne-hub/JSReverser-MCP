/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ToolDefinition} from './ToolDefinition.js';

export type ToolProfile = 'kernel' | 'compact' | 'research' | 'full';

export const KERNEL_TOOL_NAMES = new Set([
  'analyze_source_maps',
  'auto_rebuild_fix_loop',
  'collect_code',
  'create_reverse_task_from_request',
  'diagnose_environment',
  'diff_session_state',
  'explain_reverse_stage',
  'export_diagnostic_bundle',
  'export_har_snapshot',
  'export_rebuild_bundle',
  'generate_parameter_report',
  'get_rebuild_health_report',
  'get_reference',
  'get_reference_route',
  'infer_websocket_schema',
  'list_pages',
  'list_task_artifacts',
  'locate_candidate_functions',
  'manage_reverse_task',
  'navigate_page',
  'network_request',
  'orchestrate_reverse_task',
  'probe_runtime_capabilities',
  'recommend_next_step',
  'record_page_flow',
  'record_reverse_evidence',
  'repair_browser_connection',
  'replay_page_flow',
  'run_reverse_agent',
  'search_in_scripts',
  'search_in_sources',
  'select_page',
  'start_reverse_task',
  'trace_request_to_code',
  'understand_code',
]);

export const COMPACT_TOOL_NAMES = new Set([  'check_browser_health',
  'collect_code',
  'console_message',
  'create_hook',
  'create_reverse_task_from_request',
  'diagnose_environment',
  'diff_env_requirements',
  'diff_session_state',
  'emulate_device',
  'analyze_source_maps',
  'auto_rebuild_fix_loop',
  'evaluate_script',
  'explain_reverse_stage',
  'export_diagnostic_bundle',
  'export_function_slice',
  'export_har_snapshot',
  'export_portable_bundle',
  'export_rebuild_bundle',
  'extract_function_tree',
  'generate_parameter_report',
  'get_all_links',
  'get_hook_data',
  'get_parameter_workflow',
  'get_rebuild_health_report',
  'get_reference',
  'get_reference_route',
  'hover_element',
  'infer_websocket_schema',
  'inject_hook',
  'list_task_artifacts',
  'list_pages',
  'list_parameter_workflows',
  'locate_candidate_functions',
  'locate_signature_function',
  'manage_reverse_task',
  'navigate_page',
  'network_request',
  'new_page',
  'orchestrate_reverse_task',
  'probe_runtime_capabilities',
  'prune_task_artifacts',
  'record_page_flow',
  'recommend_next_step',
  'recommend_parameter_workflow',
  'record_reverse_evidence',
  'remove_hook',
  'press_key',
  'repair_browser_connection',
  'replay_page_flow',
  'run_reverse_agent',
  'search_in_scripts',
  'search_in_sources',
  'select_page',
  'select_option',
  'session_state',
  'set_viewport',
  'scroll_page',
  'start_reverse_task',
  'take_screenshot',
  'trace_request_to_code',
  'understand_code',
  'upload_file',
  'wait_for_network_idle',
]);

/**
 * Research profile（2026-09-02，viber research goldset 实证驱动）。
 *
 * 依据：agent-under-goldset 两轮完整 run 实证——从 full(110) 里实际只调用
 * evaluate_script(9x)/network_request(6x)/search_in_sources(3x)/get_script_source/
 * find_in_script/check_browser_health/navigate_page/new_page/click_element/
 * collect_code/wait_for_network_idle/list_scripts/take_screenshot/get_all_links/
 * start_reverse_task/get_dom_structure/query_dom 等 17 个；反混淆/调试器/WS 深分析
 * 零调用。本档 = 实证工具 + Observe-first/Hook-preferred 方法论高频备用（网络链路
 * 定位、Hook 采样、会话复用），**去掉**：断点/单步调试器、反混淆/代码分析专项
 * （deobfuscate_code/understand_code/risk_panel/detect_crypto/summarize_code/
 * analyze_*）、WebSocket 深分析、任务编排/打包导出。
 */
export const RESEARCH_TOOL_NAMES = new Set([
  // 观察 / 请求链路
  'check_browser_health',
  'evaluate_script',
  'network_request',
  'list_network_requests',
  'get_network_request',
  'get_request_initiator',
  'list_pages',
  'select_page',
  'take_screenshot',
  'get_all_links',
  // 源码定位
  'list_scripts',
  'get_script_source',
  'find_in_script',
  // 2026-09-02：search_in_sources/search_in_scripts 从 research 档移除——
  // 两者逐脚本全量拉源码（遇多 MB minified chunk 必超时，goldset r3/r4/r5 反复
  // 300s 超时实证）。替代：list_scripts 定脚本范围 → get_script_source 读源码 →
  // find_in_script 定位（NOTES 静态定位模块实证：优先 find_in_script）。
  'get_dom_structure',
  'query_dom',
  // 导航 / 触真交互
  'navigate_page',
  'wait_for_network_idle',
  'new_page',
  'click_element',
  'hover_element',
  'type_text',
  'select_option',
  'scroll_page',
  'press_key',
  // Hook 采样（Observe-first / Hook-preferred）
  'create_hook',
  'inject_hook',
  'get_hook_data',
  'hook_function',
  'trace_function',
  'remove_hook',
  // 采集 / 证据
  'collect_code',
  'start_reverse_task',
  'record_reverse_evidence',
  // 会话复用
  'save_session_state',
  'restore_session_state',
  // 环境诊断
  'diagnose_environment',
]);

export function selectToolsForProfile(
  tools: ToolDefinition[],
  profile: ToolProfile = 'kernel',
): ToolDefinition[] {
  if (profile === 'full') {
    return tools;
  }

  const selectedNames =
    profile === 'compact'
      ? COMPACT_TOOL_NAMES
      : profile === 'research'
        ? RESEARCH_TOOL_NAMES
        : KERNEL_TOOL_NAMES;
  return tools.filter(tool => selectedNames.has(tool.name));
}

export function describeToolProfileSelection(
  tools: ToolDefinition[],
  profile: ToolProfile = 'kernel',
): {
  profile: ToolProfile;
  selectedToolNames: string[];
  hiddenToolNames: string[];
  hint: string;
} {
  const selected = selectToolsForProfile(tools, profile).map(tool => tool.name);
  const selectedSet = new Set(selected);
  const hidden =
    profile === 'full'
      ? []
      : tools
          .map(tool => tool.name)
          .filter(name => !selectedSet.has(name))
          .sort();

  return {
    profile,
    selectedToolNames: selected,
    hiddenToolNames: hidden,
    hint:
      hidden.length > 0
        ? profile === 'kernel'
          ? `Kernel profile hid ${hidden.length} tools. Restart with --toolProfile compact for broader workflow controls, --toolProfile research for JS-reverse deep-dive, or --toolProfile full when you need low-level debugging controls.`
          : profile === 'research'
            ? `Research profile hid ${hidden.length} tools (debuggers/deobfuscators/WS deep-analysis). Restart with --toolProfile full if you need them.`
            : `Compact profile hid ${hidden.length} tools. Restart with --toolProfile full or set toolProfile=full when you need low-level debugging controls.`
        : 'All registered tools are available in this profile.',
  };
}
