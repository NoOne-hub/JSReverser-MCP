# js-reverse-mcp-main 专用任务模板
按固定步骤执行：
1) check_browser_health
2) new_page + (可选 restore_session_state)
3) analyze_target + search_in_scripts
4) create_hook(fetch/xhr) + inject_hook
5) 触发动作 + get_hook_data(summary)
6) 命中后 get_hook_data(raw) + get_request_initiator
7) export_session_report
