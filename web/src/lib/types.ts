export interface Role {
  id: number;
  code: string;
  name: string;
  description: string;
  permissions: string[];
  is_system: boolean;
  user_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  title: string;
  role_id: number;
  role_name?: string;
  role_code?: string;
  role?: Role;
  permissions?: string[];
  status: 'active' | 'disabled';
  avatar_color: string;
  avatar_url?: string;
  feishu_open_id?: string;
  wecom_userid?: string;
  last_login_at?: string | null;
  created_at: string;
}

export interface CIType {
  id: number;
  code: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  builtin: boolean;
  rackable: boolean;
  enabled: boolean;
  sort_order: number;
  ci_count?: number;
  field_count?: number;
  fields?: CIField[];
}

export interface CIField {
  id: number;
  ci_type_id: number;
  field_key: string;
  label: string;
  field_type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multiselect' | 'ci_ref';
  options: string[];
  placeholder: string;
  group_name: string;
  required: boolean;
  show_in_list: boolean;
  sort_order: number;
}

export interface CI {
  id: number;
  asset_no: string;
  name: string;
  ci_type_id: number;
  type_name?: string;
  type_code?: string;
  type_color?: string;
  type_icon?: string;
  status: string;
  criticality: string;
  environment: string;
  owner_id?: number | null;
  owner_name?: string | null;
  owner_email?: string | null;
  owner_avatar_url?: string | null;
  department: string;
  location: string;
  vendor: string;
  model: string;
  serial_no: string;
  ip_address: string;
  mac_address: string;
  bmc_address: string;
  os_name: string;
  cpu: string;
  memory: string;
  disk: string;
  purchase_date: string;
  warranty_end: string;
  cost: number;
  description: string;
  attributes: Record<string, any>;
  created_at: string;
  updated_at: string;
  fields?: CIField[];
  relations?: CIRelation[];
  incoming_relations?: CIRelation[];
  tickets?: any[];
  history?: any[];
  ports?: CINetworkPort[];
  placement?: RackPlacement | null;
  [key: string]: any;
}

export interface CINetworkPort {
  id: number;
  ci_id: number;
  port_name: string;
  port_type: 'ethernet' | 'fiber' | 'bmc' | 'management' | 'console' | 'power';
  mac_address: string;
  speed_mbps: number;
  current_speed_mbps: number;
  connected_switch_id?: number | null;
  connected_switch_port: string;
  switch_asset_no?: string;
  switch_name?: string;
  switch_type_name?: string;
  link_status: 'up' | 'down' | 'unknown';
  source: 'manual' | 'zabbix' | 'zabbix-agent';
  last_synced_at?: string | null;
  notes: string;
}

export interface CIRelationType {
  id: number;
  code: string;
  name: string;
  reverse_name: string;
  from_type_id?: number | null;
  to_type_id?: number | null;
  from_type_name?: string;
  to_type_name?: string;
  color: string;
  description: string;
  builtin: boolean;
  enabled: boolean;
  sort_order: number;
  usage_count?: number;
}

export interface RackPlacement {
  id: number;
  rack_id: number;
  ci_id: number;
  start_u: number;
  u_height: number;
  side: 'front' | 'rear';
  asset_no: string;
  name: string;
  type_name: string;
  type_code: string;
  type_color: string;
  status: string;
  criticality: string;
  ip_address: string;
  bmc_address: string;
  rack_asset_no?: string;
  rack_name?: string;
  capacity_u?: number;
  numbering?: 'bottom_up' | 'top_down';
  datacenter_name?: string;
  attributes?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface CIRelation {
  id: number;
  source_ci_id: number;
  target_ci_id: number;
  relation_type: string;
  description: string;
  direction: 'outgoing' | 'incoming';
  target_asset_no?: string;
  target_name?: string;
  target_status?: 'in_use' | 'idle' | 'reserved' | 'offline' | string;
  target_type_name?: string;
  target_type_color?: string;
  source_asset_no?: string;
  source_name?: string;
  source_status?: 'in_use' | 'idle' | 'reserved' | 'offline' | string;
  source_type_name?: string;
  source_type_color?: string;
  relation_forward_label?: string;
  relation_reverse_label?: string;
  relation_type_color?: string;
}

export interface WorkflowStage {
  id: number;
  workflow_id: number;
  stage_key: string;
  name: string;
  stage_type: 'start' | 'task' | 'approval' | 'end';
  seq: number;
  color: string;
  description: string;
  sla_hours: number;
  assignee_role_id?: number | null;
  approver_role_id?: number | null;
  assignee_role_name?: string;
  approver_role_name?: string;
}

export interface Workflow {
  id: number;
  name: string;
  code: string;
  ticket_type: 'incident' | 'problem' | 'change';
  description: string;
  is_default: boolean;
  is_active: boolean;
  version: number;
  stages: WorkflowStage[];
  ticket_count: number;
  ticket_status?: Record<string, number>;
  created_at?: string;
  updated_at?: string;
}

export interface Ticket {
  id: number;
  ticket_no: string;
  type: 'incident' | 'problem' | 'change';
  title: string;
  description: string;
  status: string;
  priority: string;
  impact: string;
  urgency: string;
  category: string;
  source: string;
  requester_id: number;
  requester_name?: string;
  requester_department?: string;
  requester_color?: string;
  requester_avatar_url?: string;
  assignee_id?: number | null;
  assignee_name?: string | null;
  assignee_color?: string | null;
  assignee_avatar_url?: string | null;
  workflow_id: number;
  workflow_name?: string;
  current_stage_id: number;
  stage_name?: string;
  stage_type?: string;
  stage_color?: string;
  resolution?: string;
  sla_due_at?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  root_cause?: string;
  workaround?: string;
  risk?: string;
  change_type?: string;
  planned_start?: string;
  planned_end?: string;
  implementation_plan?: string;
  rollback_plan?: string;
  test_plan?: string;
  cab_date?: string;
  outage_required?: boolean;
  is_overdue?: boolean;
  created_at: string;
  updated_at: string;
  comments?: TicketComment[];
  attachments?: Array<{ id: number; filename: string; mime_type: string; size: number; uploader_name?: string; created_at: string }>;
  history?: TicketHistory[];
  stages?: WorkflowStage[];
  cis?: CI[];
  relations?: any[];
  incoming_relations?: any[];
  deletion_request?: any;
}

export interface TicketComment {
  id: number;
  ticket_id: number;
  user_id?: number | null;
  user_name?: string;
  user_color?: string;
  user_avatar_url?: string;
  user_department?: string;
  body: string;
  is_internal: boolean;
  created_at: string;
}

export interface TicketHistory {
  id: number;
  ticket_id: number;
  stage_id?: number | null;
  stage_name: string;
  action: string;
  actor_id?: number | null;
  actor_name?: string | null;
  actor_color?: string | null;
  actor_avatar_url?: string | null;
  comment: string;
  created_at: string;
}

export interface ZabbixIntegration {
  id: number;
  name: string;
  base_url: string;
  api_token: string;
  has_token: boolean;
  webhook_secret: string;
  enabled: boolean;
  workflow_id?: number | null;
  default_assignee_id?: number | null;
  severity_threshold: string;
  conditions: Array<{ field: string; operator: string; value: string }>;
  create_only_on_problem: boolean;
  reopen_resolved: boolean;
  mapping: Record<string, any>;
  last_sync_at?: string | null;
  last_host_sync_at?: string | null;
  last_inventory_sync_at?: string | null;
  last_test_at?: string | null;
  last_test_status?: string | null;
  event_count?: number;
  ticket_count?: number;
}

export interface ZabbixEvent {
  id: number;
  integration_id: number;
  integration_name?: string;
  event_id: string;
  trigger_id: string;
  host_name: string;
  host_ip: string;
  severity: string;
  severity_label?: string;
  event_name: string;
  event_status: string;
  tags: Array<{ tag: string; value: string }>;
  ticket_id?: number | null;
  ticket_no?: string | null;
  ticket_title?: string | null;
  ticket_status?: string | null;
  processing_status: string;
  processing_note: string;
  received_at: string;
  payload?: any;
  normalized?: any;
}

export interface NotificationChannel {
  id: number;
  type: 'email' | 'feishu' | 'wecom';
  name: string;
  enabled: boolean;
  events: string[];
  config: Record<string, any>;
  last_test_at?: string | null;
  last_test_status?: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationLog {
  id: number;
  channel_id?: number | null;
  channel_type: string;
  channel_name: string;
  event_type: string;
  ticket_id?: number | null;
  target: string;
  title: string;
  content?: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  created_at: string;
}
