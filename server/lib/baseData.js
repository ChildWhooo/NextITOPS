export const DEFAULT_BASE_DATA = {
  ticket_sources: [
    { value: 'portal', label: '服务门户' },
    { value: 'im', label: 'IM 报障' },
    { value: 'phone', label: '电话' },
    { value: 'email', label: '邮件' },
    { value: 'monitoring', label: '监控系统' },
    { value: 'zabbix', label: 'Zabbix' },
    { value: 'inspection', label: '巡检' },
    { value: 'admin', label: '管理员创建' },
  ],
  priorities: [
    { value: 'critical', label: '紧急' },
    { value: 'high', label: '高' },
    { value: 'medium', label: '中' },
    { value: 'low', label: '低' },
  ],
  impacts: [
    { value: 'high', label: '高 · 多业务/用户' },
    { value: 'medium', label: '中 · 单业务' },
    { value: 'low', label: '低 · 个人' },
  ],
  urgencies: [
    { value: 'critical', label: '紧急' },
    { value: 'high', label: '高' },
    { value: 'medium', label: '中' },
    { value: 'low', label: '低' },
  ],
  change_types: [
    { value: 'standard', label: '标准变更' },
    { value: 'normal', label: '普通变更' },
    { value: 'emergency', label: '紧急变更' },
  ],
  risks: [
    { value: 'high', label: '高风险' },
    { value: 'medium', label: '中风险' },
    { value: 'low', label: '低风险' },
  ],
};
