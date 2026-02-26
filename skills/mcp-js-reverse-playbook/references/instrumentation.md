# 插桩策略（含 VMP）
- Hook-first，Breakpoint-last。
- VMP 首轮最小采样：opcode、ip/pc、栈顶摘要、关键寄存器摘要、输出摘要。
- 禁止首轮全量状态采样。
