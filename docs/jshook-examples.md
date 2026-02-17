# JSHook Usage Examples

## Collect + Analyze

1. `collect_code` with `smartMode=summary`
2. `search_in_scripts` with `pattern="encrypt|sign|crypto"`
3. `understand_code` on selected code blocks
4. `detect_crypto` for crypto fingerprinting

## Hook Injection

1. `create_hook` with `type="fetch"`
2. `inject_hook` with returned `hookId`
3. Trigger requests in the page
4. `get_hook_data`

## Stealth + DOM automation

1. `inject_stealth` with `preset="windows-chrome"`
2. `navigate_page`
3. `query_dom` / `find_clickable_elements`
4. `click_element`, `type_text`, `wait_for_element`
