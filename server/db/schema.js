/**
 * Portable schema for SQLite / PostgreSQL / MySQL.
 * JSON payloads are stored as TEXT so the same schema runs on every supported database.
 */
export async function createSchema(db) {
  const hasUsers = await db.schema.hasTable('users');
  if (hasUsers) {
    await upgradeSchema(db);
    return;
  }

  await db.schema.createTable('roles', (t) => {
    t.increments('id').primary();
    t.string('code', 60).notNullable().unique();
    t.string('name', 100).notNullable();
    t.string('description', 500).defaultTo('');
    t.text('permissions').notNullable();
    t.boolean('is_system').notNullable().defaultTo(false);
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
  });

  await db.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('username', 60).notNullable().unique();
    t.string('password_hash', 200).notNullable();
    t.string('password_changed_at', 40);
    t.boolean('must_change_password').notNullable().defaultTo(false);
    t.string('allowed_ips', 500).defaultTo('');
    t.string('bound_mac', 80).defaultTo('');
    t.string('name', 100).notNullable();
    t.string('email', 160).defaultTo('');
    t.string('phone', 255).defaultTo('');
    t.string('department', 120).defaultTo('');
    t.string('title', 120).defaultTo('');
    t.integer('role_id').unsigned().notNullable().references('id').inTable('roles');
    t.string('status', 30).notNullable().defaultTo('active');
    t.string('avatar_color', 20).defaultTo('#4f6ef7');
    t.string('avatar_url', 500).defaultTo('');
    t.string('feishu_open_id', 120).defaultTo('');
    t.string('wecom_userid', 120).defaultTo('');
    t.string('privacy_consent_version', 40).defaultTo('');
    t.string('privacy_consent_at', 40);
    t.string('privacy_consent_ip', 80).defaultTo('');
    t.string('last_login_at', 40);
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['role_id']);
    t.index(['status']);
  });

  await db.schema.createTable('ci_types', (t) => {
    t.increments('id').primary();
    t.string('code', 60).notNullable().unique();
    t.string('name', 100).notNullable();
    t.string('icon', 60).defaultTo('Box');
    t.string('color', 20).defaultTo('#4f6ef7');
    t.string('description', 500).defaultTo('');
    t.boolean('builtin').notNullable().defaultTo(false);
    t.boolean('rackable').notNullable().defaultTo(false);
    t.boolean('enabled').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
  });

  await db.schema.createTable('ci_relation_types', (t) => {
    t.increments('id').primary();
    t.string('code', 40).notNullable().unique();
    t.string('name', 120).notNullable();
    t.string('reverse_name', 120).notNullable();
    t.integer('from_type_id').unsigned().references('id').inTable('ci_types').onDelete('SET NULL');
    t.integer('to_type_id').unsigned().references('id').inTable('ci_types').onDelete('SET NULL');
    t.string('color', 20).defaultTo('#4f6ef7');
    t.string('description', 300).defaultTo('');
    t.boolean('builtin').notNullable().defaultTo(false);
    t.boolean('enabled').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['from_type_id']);
    t.index(['to_type_id']);
  });

  await db.schema.createTable('ci_field_defs', (t) => {
    t.increments('id').primary();
    t.integer('ci_type_id').unsigned().notNullable().references('id').inTable('ci_types').onDelete('CASCADE');
    t.string('field_key', 80).notNullable();
    t.string('label', 120).notNullable();
    t.string('field_type', 30).notNullable().defaultTo('text');
    t.text('options');
    t.string('placeholder', 200).defaultTo('');
    t.string('group_name', 80).defaultTo('扩展属性');
    t.boolean('required').notNullable().defaultTo(false);
    t.boolean('show_in_list').notNullable().defaultTo(false);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.string('created_at', 40).notNullable();
    t.unique(['ci_type_id', 'field_key']);
    t.index(['ci_type_id']);
  });

  await db.schema.createTable('cis', (t) => {
    t.increments('id').primary();
    t.string('asset_no', 80).notNullable().unique();
    t.string('name', 200).notNullable();
    t.integer('ci_type_id').unsigned().notNullable().references('id').inTable('ci_types');
    t.string('status', 30).notNullable().defaultTo('in_use');
    t.string('criticality', 20).notNullable().defaultTo('medium');
    t.string('environment', 30).notNullable().defaultTo('production');
    t.integer('owner_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.integer('asset_manager_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.string('department', 120).defaultTo('');
    t.string('location', 200).defaultTo('');
    t.string('vendor', 120).defaultTo('');
    t.string('model', 120).defaultTo('');
    t.string('serial_no', 120).defaultTo('');
    t.string('ip_address', 80).defaultTo('');
    t.string('mac_address', 80).defaultTo('');
    t.string('zabbix_host_id', 80).defaultTo('');
    t.string('zabbix_host', 200).defaultTo('');
    t.integer('zabbix_integration_id').unsigned();
    t.string('zabbix_last_seen_at', 40);
    t.string('bmc_address', 120).defaultTo('');
    t.string('os_name', 160).defaultTo('');
    t.string('cpu', 120).defaultTo('');
    t.string('memory', 80).defaultTo('');
    t.string('disk', 120).defaultTo('');
    t.string('purchase_date', 40).defaultTo('');
    t.string('warranty_end', 40).defaultTo('');
    t.decimal('cost', 14, 2).defaultTo(0);
    t.text('description');
    t.text('attributes');
    t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['ci_type_id']);
    t.index(['status']);
    t.index(['criticality']);
    t.index(['owner_id']);
  });

  await db.schema.createTable('ci_change_logs', (t) => {
    t.increments('id').primary();
    t.integer('ci_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
    t.string('action', 40).notNullable();
    t.text('changes').defaultTo('{}');
    t.string('source', 30).notNullable().defaultTo('manual');
    t.integer('ticket_id').unsigned();
    t.integer('actor_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.string('created_at', 40).notNullable();
    t.index(['ci_id']);
    t.index(['ticket_id']);
  });

  await db.schema.createTable('ci_acl', (t) => {
    t.increments('id').primary();
    t.integer('ci_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.boolean('can_view').notNullable().defaultTo(true);
    t.boolean('can_edit').notNullable().defaultTo(false);
    t.string('created_at', 40).notNullable();
    t.unique(['ci_id', 'user_id']);
  });

  await db.schema.createTable('ci_ips', (t) => {
    t.increments('id').primary();
    t.integer('ci_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
    t.string('ip_address', 80).notNullable();
    t.string('interface_name', 80).defaultTo('');
    t.string('status', 30).notNullable().defaultTo('active');
    t.string('source', 30).notNullable().defaultTo('manual');
    t.string('last_seen_at', 40);
    t.string('released_at', 40);
    t.string('created_at', 40).notNullable();
    t.index(['ip_address']);
    t.index(['ci_id']);
  });

  await db.schema.createTable('ci_relations', (t) => {
    t.increments('id').primary();
    t.integer('source_ci_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
    t.integer('target_ci_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
    t.string('relation_type', 40).notNullable().defaultTo('depends_on');
    t.string('description', 300).defaultTo('');
    t.string('created_at', 40).notNullable();
    t.unique(['source_ci_id', 'target_ci_id', 'relation_type']);
    t.index(['source_ci_id']);
    t.index(['target_ci_id']);
  });

  await db.schema.createTable('rack_profiles', (t) => {
    t.increments('id').primary();
    t.integer('ci_id').unsigned().notNullable().unique().references('id').inTable('cis').onDelete('CASCADE');
    t.integer('datacenter_id').unsigned().references('id').inTable('cis').onDelete('SET NULL');
    t.integer('capacity_u').notNullable().defaultTo(47);
    t.string('numbering', 30).notNullable().defaultTo('bottom_up');
    t.string('notes', 300).defaultTo('');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['datacenter_id']);
  });

  await db.schema.createTable('rack_placements', (t) => {
    t.increments('id').primary();
    t.integer('rack_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
    t.integer('ci_id').unsigned().notNullable().unique().references('id').inTable('cis').onDelete('CASCADE');
    t.integer('start_u').notNullable();
    t.integer('u_height').notNullable().defaultTo(1);
    t.string('side', 20).notNullable().defaultTo('front');
    t.string('notes', 300).defaultTo('');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['rack_id']);
    t.index(['start_u']);
  });

  await db.schema.createTable('rack_blank_units', (t) => {
    t.increments('id').primary();
    t.integer('rack_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
    t.integer('start_u').notNullable();
    t.integer('u_height').notNullable().defaultTo(1);
    t.string('notes', 300).defaultTo('');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['rack_id']);
    t.index(['start_u']);
  });

  await db.schema.createTable('ci_network_ports', (t) => {
    t.increments('id').primary();
    t.integer('ci_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
    t.string('port_name', 80).notNullable();
    t.string('port_type', 30).notNullable().defaultTo('ethernet');
    t.string('mac_address', 80).defaultTo('');
    t.integer('speed_mbps').defaultTo(0);
    t.integer('current_speed_mbps').defaultTo(0);
    t.integer('connected_switch_id').unsigned().references('id').inTable('cis').onDelete('SET NULL');
    t.string('connected_switch_port', 120).defaultTo('');
    t.string('link_status', 20).notNullable().defaultTo('unknown');
    t.string('source', 30).notNullable().defaultTo('manual');
    t.string('last_synced_at', 40);
    t.string('notes', 300).defaultTo('');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.unique(['ci_id', 'port_name']);
    t.index(['ci_id']);
    t.index(['connected_switch_id']);
  });

  await db.schema.createTable('workflows', (t) => {
    t.increments('id').primary();
    t.string('name', 120).notNullable();
    t.string('code', 80).notNullable().unique();
    t.string('ticket_type', 30).notNullable();
    t.string('description', 500).defaultTo('');
    t.boolean('is_default').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('version').notNullable().defaultTo(1);
    t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['ticket_type']);
  });

  await db.schema.createTable('workflow_stages', (t) => {
    t.increments('id').primary();
    t.integer('workflow_id').unsigned().notNullable().references('id').inTable('workflows').onDelete('CASCADE');
    t.string('stage_key', 80).notNullable();
    t.string('name', 120).notNullable();
    t.string('stage_type', 30).notNullable().defaultTo('task');
    t.integer('seq').notNullable();
    t.string('color', 20).defaultTo('#4f6ef7');
    t.string('description', 300).defaultTo('');
    t.integer('sla_hours').notNullable().defaultTo(24);
    t.integer('assignee_role_id').unsigned().references('id').inTable('roles').onDelete('SET NULL');
    t.integer('approver_role_id').unsigned().references('id').inTable('roles').onDelete('SET NULL');
    t.string('created_at', 40).notNullable();
    t.unique(['workflow_id', 'seq']);
    t.unique(['workflow_id', 'stage_key']);
    t.index(['workflow_id']);
  });

  await db.schema.createTable('tickets', (t) => {
    t.increments('id').primary();
    t.string('ticket_no', 40).notNullable().unique();
    t.string('type', 30).notNullable();
    t.string('title', 240).notNullable();
    t.text('description');
    t.string('status', 30).notNullable().defaultTo('new');
    t.string('priority', 20).notNullable().defaultTo('medium');
    t.string('impact', 20).notNullable().defaultTo('medium');
    t.string('urgency', 20).notNullable().defaultTo('medium');
    t.string('category', 80).defaultTo('');
    t.string('source', 40).notNullable().defaultTo('portal');
    t.integer('requester_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.integer('assignee_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.integer('workflow_id').unsigned().references('id').inTable('workflows').onDelete('SET NULL');
    t.integer('current_stage_id').unsigned().references('id').inTable('workflow_stages').onDelete('SET NULL');
    t.text('resolution');
    t.string('sla_due_at', 40);
    t.string('resolved_at', 40);
    t.string('closed_at', 40);
    t.text('root_cause');
    t.text('workaround');
    t.string('risk', 20).defaultTo('medium');
    t.string('change_type', 40).defaultTo('normal');
    t.string('planned_start', 40).defaultTo('');
    t.string('planned_end', 40).defaultTo('');
    t.text('implementation_plan');
    t.text('rollback_plan');
    t.text('test_plan');
    t.text('change_updates');
    t.string('cab_date', 40).defaultTo('');
    t.boolean('outage_required').defaultTo(false);
    t.integer('zabbix_event_id').unsigned();
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['type']);
    t.index(['status']);
    t.index(['priority']);
    t.index(['assignee_id']);
    t.index(['workflow_id']);
    t.index(['created_at']);
  });

  await db.schema.createTable('ticket_deletion_requests', (t) => {
    t.increments('id').primary();
    t.integer('ticket_id').unsigned().references('id').inTable('tickets').onDelete('SET NULL');
    t.string('ticket_no', 60).notNullable();
    t.string('ticket_type', 30).notNullable();
    t.string('ticket_title', 240).notNullable();
    t.integer('requested_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.text('reason').notNullable();
    t.string('status', 30).notNullable().defaultTo('pending');
    t.integer('reviewed_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.text('review_comment');
    t.string('created_at', 40).notNullable();
    t.string('reviewed_at', 40);
    t.index(['status']);
    t.index(['ticket_id']);
  });

  await db.schema.createTable('deletion_policies', (t) => {
    t.increments('id').primary();
    t.text('approver_role_ids').notNullable().defaultTo('[]');
    t.integer('updated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.string('updated_at', 40).notNullable();
  });

  await db.schema.createTable('system_settings', (t) => {
    t.increments('id').primary();
    t.string('setting_key', 80).notNullable().unique();
    t.text('setting_value');
    t.string('updated_at', 40).notNullable();
  });

  await db.schema.createTable('maintenance_notices', (t) => {
    t.increments('id').primary();
    t.string('title', 200).notNullable();
    t.text('content').notNullable();
    t.string('start_at', 40).notNullable();
    t.string('end_at', 40).notNullable();
    t.string('status', 30).notNullable().defaultTo('planned');
    t.boolean('notify_users').notNullable().defaultTo(false);
    t.string('notified_at', 40);
    t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['start_at']);
    t.index(['status']);
  });

  await db.schema.createTable('ci_deletion_requests', (t) => {
    t.increments('id').primary();
    t.integer('ci_id').unsigned().references('id').inTable('cis').onDelete('SET NULL');
    t.string('ci_asset_no', 120).notNullable();
    t.string('ci_name', 200).notNullable();
    t.string('ci_type_name', 120).defaultTo('');
    t.integer('requester_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.string('reason', 500).defaultTo('');
    t.string('status', 30).notNullable().defaultTo('pending');
    t.integer('reviewed_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.string('review_comment', 500).defaultTo('');
    t.text('snapshot');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['status']);
    t.index(['ci_id']);
  });

  await db.schema.createTable('datacenter_links', (t) => {
    t.increments('id').primary();
    t.integer('source_dc_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
    t.integer('target_dc_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
    t.string('name', 160).defaultTo('');
    t.string('carrier', 80).defaultTo('');
    t.integer('bandwidth_mbps').notNullable().defaultTo(0);
    t.string('status', 30).notNullable().defaultTo('up');
    t.string('source', 30).notNullable().defaultTo('manual');
    t.integer('zabbix_ci_id').unsigned().references('id').inTable('cis').onDelete('SET NULL');
    t.string('zabbix_metric', 160).defaultTo('');
    t.string('notes', 300).defaultTo('');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.unique(['source_dc_id', 'target_dc_id', 'name']);
    t.index(['source_dc_id']);
    t.index(['target_dc_id']);
  });

  await db.schema.createTable('ticket_stage_history', (t) => {
    t.increments('id').primary();
    t.integer('ticket_id').unsigned().notNullable().references('id').inTable('tickets').onDelete('CASCADE');
    t.integer('stage_id').unsigned().references('id').inTable('workflow_stages').onDelete('SET NULL');
    t.string('stage_name', 120).defaultTo('');
    t.string('action', 40).notNullable();
    t.integer('actor_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.text('comment');
    t.string('created_at', 40).notNullable();
    t.index(['ticket_id']);
  });

  await db.schema.createTable('ticket_comments', (t) => {
    t.increments('id').primary();
    t.integer('ticket_id').unsigned().notNullable().references('id').inTable('tickets').onDelete('CASCADE');
    t.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.text('body').notNullable();
    t.boolean('is_internal').notNullable().defaultTo(false);
    t.string('created_at', 40).notNullable();
    t.index(['ticket_id']);
  });

  await db.schema.createTable('ip_assets', (t) => {
    t.increments('id').primary();
    t.string('ip_address', 80).notNullable().unique();
    t.string('status', 30).notNullable().defaultTo('in_use');
    t.string('owner', 120).defaultTo('');
    t.string('notes', 500).defaultTo('');
    t.integer('ci_id').unsigned().references('id').inTable('cis').onDelete('SET NULL');
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
  });

  await db.schema.createTable('ip_assignment_history', (t) => {
    t.increments('id').primary();
    t.string('ip_address', 80).notNullable();
    t.string('action', 40).notNullable();
    t.string('previous_asset_no', 120).defaultTo('');
    t.string('previous_owner', 120).defaultTo('');
    t.string('previous_notes', 500).defaultTo('');
    t.integer('new_ci_id').unsigned().references('id').inTable('cis').onDelete('SET NULL');
    t.string('new_asset_no', 120).defaultTo('');
    t.integer('actor_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.string('created_at', 40).notNullable();
    t.index(['ip_address']);
  });

  await db.schema.createTable('ip_subnets', (t) => {
    t.increments('id').primary();
    t.string('subnet', 80).notNullable().unique();
    t.string('label', 120).defaultTo('');
    t.string('vlan', 60).defaultTo('');
    t.string('notes', 500).defaultTo('');
    t.string('updated_at', 40).notNullable();
  });

  await db.schema.createTable('rich_attachments', (t) => {
    t.increments('id').primary();
    t.string('token', 100).notNullable().unique();
    t.string('filename', 300).notNullable();
    t.string('stored_name', 300).notNullable();
    t.string('mime_type', 160).defaultTo('application/octet-stream');
    t.integer('size').defaultTo(0);
    t.integer('uploaded_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.string('created_at', 40).notNullable();
  });

  await db.schema.createTable('ticket_attachments', (t) => {
    t.increments('id').primary();
    t.integer('ticket_id').unsigned().notNullable().references('id').inTable('tickets').onDelete('CASCADE');
    t.integer('comment_id').unsigned().references('id').inTable('ticket_comments').onDelete('SET NULL');
    t.string('filename', 300).notNullable();
    t.string('stored_name', 300).notNullable();
    t.string('mime_type', 160).defaultTo('application/octet-stream');
    t.integer('size').defaultTo(0);
    t.integer('uploaded_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.string('created_at', 40).notNullable();
    t.index(['ticket_id']);
  });

  await db.schema.createTable('ticket_cis', (t) => {
    t.increments('id').primary();
    t.integer('ticket_id').unsigned().notNullable().references('id').inTable('tickets').onDelete('CASCADE');
    t.integer('ci_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
    t.string('created_at', 40).notNullable();
    t.unique(['ticket_id', 'ci_id']);
    t.index(['ci_id']);
  });

  await db.schema.createTable('ticket_relations', (t) => {
    t.increments('id').primary();
    t.integer('ticket_id').unsigned().notNullable().references('id').inTable('tickets').onDelete('CASCADE');
    t.integer('linked_ticket_id').unsigned().notNullable().references('id').inTable('tickets').onDelete('CASCADE');
    t.string('relation_type', 40).notNullable().defaultTo('related');
    t.string('created_at', 40).notNullable();
    t.unique(['ticket_id', 'linked_ticket_id', 'relation_type']);
  });

  await db.schema.createTable('zabbix_integrations', (t) => {
    t.increments('id').primary();
    t.string('name', 120).notNullable();
    t.string('base_url', 300).notNullable();
    t.text('api_token');
    t.string('webhook_secret', 80).notNullable().unique();
    t.boolean('enabled').notNullable().defaultTo(true);
    t.integer('workflow_id').unsigned().references('id').inTable('workflows').onDelete('SET NULL');
    t.integer('default_assignee_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.string('severity_threshold', 30).notNullable().defaultTo('warning');
    t.text('conditions');
    t.boolean('create_only_on_problem').notNullable().defaultTo(true);
    t.boolean('reopen_resolved').notNullable().defaultTo(true);
    t.text('mapping');
    t.string('last_sync_at', 40);
    t.string('last_host_sync_at', 40);
    t.string('last_inventory_sync_at', 40);
    t.string('last_test_at', 40);
    t.string('last_test_status', 30);
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
  });

  await db.schema.createTable('zabbix_events', (t) => {
    t.increments('id').primary();
    t.integer('integration_id').unsigned().references('id').inTable('zabbix_integrations').onDelete('SET NULL');
    t.string('event_id', 100).notNullable();
    t.string('trigger_id', 100).defaultTo('');
    t.string('host_name', 160).defaultTo('');
    t.string('host_ip', 80).defaultTo('');
    t.string('severity', 30).defaultTo('warning');
    t.string('event_name', 300).defaultTo('');
    t.string('event_status', 30).defaultTo('PROBLEM');
    t.text('tags');
    t.text('payload');
    t.integer('ticket_id').unsigned().references('id').inTable('tickets').onDelete('SET NULL');
    t.string('processing_status', 40).defaultTo('received');
    t.string('processing_note', 300).defaultTo('');
    t.string('dedupe_key', 300).notNullable().unique();
    t.string('received_at', 40).notNullable();
    t.index(['integration_id']);
    t.index(['received_at']);
  });

  await db.schema.createTable('zabbix_discovered_hosts', (t) => {
    t.increments('id').primary();
    t.integer('integration_id').unsigned().references('id').inTable('zabbix_integrations').onDelete('CASCADE');
    t.string('host_id', 80).notNullable();
    t.string('host_name', 200).notNullable();
    t.string('display_name', 200).defaultTo('');
    t.string('ip_address', 80).defaultTo('');
    t.string('zabbix_type', 40).defaultTo('');
    t.string('ci_type_code', 40).defaultTo('');
    t.string('reason', 300).defaultTo('');
    t.string('status', 30).notNullable().defaultTo('pending');
    t.text('payload');
    t.integer('ci_id').unsigned();
    t.string('first_seen_at', 40).notNullable();
    t.string('last_seen_at', 40).notNullable();
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.unique(['integration_id', 'host_id']);
    t.index(['status']);
  });

  await db.schema.createTable('zabbix_type_mappings', (t) => {
    t.increments('id').primary();
    t.string('zabbix_value', 120).notNullable().unique();
    t.integer('ci_type_id').unsigned().notNullable().references('id').inTable('ci_types').onDelete('CASCADE');
    t.string('description', 300).defaultTo('');
    t.boolean('enabled').notNullable().defaultTo(true);
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
    t.index(['ci_type_id']);
    t.index(['enabled']);
  });

  await db.schema.createTable('audit_logs', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.string('actor_name', 100).defaultTo('');
    t.string('action', 80).notNullable();
    t.string('entity_type', 60).defaultTo('');
    t.string('entity_id', 60).defaultTo('');
    t.string('summary', 300).defaultTo('');
    t.text('detail');
    t.string('ip', 80).defaultTo('');
    t.string('created_at', 40).notNullable();
    t.index(['created_at']);
    t.index(['entity_type']);
  });

  await db.schema.createTable('notification_channels', (t) => {
    t.increments('id').primary();
    t.string('type', 30).notNullable().unique();
    t.string('name', 100).notNullable();
    t.boolean('enabled').notNullable().defaultTo(false);
    t.text('events');
    t.text('config');
    t.string('last_test_at', 40);
    t.string('last_test_status', 30);
    t.string('created_at', 40).notNullable();
    t.string('updated_at', 40).notNullable();
  });

  await db.schema.createTable('notification_logs', (t) => {
    t.increments('id').primary();
    t.integer('channel_id').unsigned().references('id').inTable('notification_channels').onDelete('SET NULL');
    t.string('channel_type', 30).notNullable();
    t.string('channel_name', 100).defaultTo('');
    t.string('event_type', 60).notNullable();
    t.integer('ticket_id').unsigned().references('id').inTable('tickets').onDelete('SET NULL');
    t.string('target', 500).defaultTo('');
    t.string('title', 300).defaultTo('');
    t.text('content');
    t.string('status', 20).notNullable().defaultTo('success');
    t.text('error');
    t.string('created_at', 40).notNullable();
    t.index(['created_at']);
    t.index(['channel_type']);
    t.index(['ticket_id']);
  });

  await db.schema.createTable('system_meta', (t) => {
    t.string('meta_key', 80).primary();
    t.text('meta_value');
  });
  await db('system_meta').insert({ meta_key: 'schema_version', meta_value: '1' });
}

/**
 * Idempotent additive upgrades for databases created by an earlier build.
 * Every migration here is safe to run on each boot.
 */
async function upgradeSchema(db) {
  const client = db.client.config.client;
  if (await db.schema.hasTable('users')) {
    const phoneColumn = await db.schema.hasColumn('users', 'phone');
    if (phoneColumn && ['mysql', 'mysql2', 'pg'].includes(client)) {
      try {
        await db.schema.alterTable('users', (t) => t.string('phone', 255).alter());
      } catch (error) {
        console.warn('[schema] could not widen users.phone:', error.message);
      }
    }
  }
  const addColumn = async (table, column, callback) => {
    if (!(await db.schema.hasTable(table))) return false;
    if (await db.schema.hasColumn(table, column)) return false;
    await db.schema.alterTable(table, callback);
    console.log(`[db] migrated ${table}.${column}`);
    return true;
  };

  await addColumn('tickets', 'root_cause', (t) => t.text('root_cause'));
  await addColumn('tickets', 'workaround', (t) => t.text('workaround'));
  await addColumn('zabbix_events', 'processing_status', (t) => t.string('processing_status', 40).defaultTo('received'));
  await addColumn('zabbix_events', 'processing_note', (t) => t.string('processing_note', 300).defaultTo(''));
  await addColumn('users', 'avatar_url', (t) => t.string('avatar_url', 500).defaultTo(''));
  await addColumn('users', 'feishu_open_id', (t) => t.string('feishu_open_id', 120).defaultTo(''));
  await addColumn('users', 'wecom_userid', (t) => t.string('wecom_userid', 120).defaultTo(''));
  await addColumn('users', 'privacy_consent_version', (t) => t.string('privacy_consent_version', 40).defaultTo(''));
  await addColumn('users', 'privacy_consent_at', (t) => t.string('privacy_consent_at', 40));
  await addColumn('users', 'privacy_consent_ip', (t) => t.string('privacy_consent_ip', 80).defaultTo(''));
  await addColumn('users', 'password_changed_at', (t) => t.string('password_changed_at', 40));
  await addColumn('users', 'must_change_password', (t) => t.boolean('must_change_password').notNullable().defaultTo(false));
  await addColumn('tickets', 'change_updates', (t) => t.text('change_updates'));
  await addColumn('zabbix_integrations', 'last_host_sync_at', (t) => t.string('last_host_sync_at', 40));
  await addColumn('zabbix_integrations', 'last_inventory_sync_at', (t) => t.string('last_inventory_sync_at', 40));
  await addColumn('cis', 'zabbix_host_id', (t) => t.string('zabbix_host_id', 80).defaultTo(''));
  await addColumn('cis', 'zabbix_host', (t) => t.string('zabbix_host', 200).defaultTo(''));
  await addColumn('cis', 'zabbix_integration_id', (t) => t.integer('zabbix_integration_id').unsigned());
  await addColumn('cis', 'zabbix_last_seen_at', (t) => t.string('zabbix_last_seen_at', 40));
  if (!(await db.schema.hasTable('zabbix_discovered_hosts'))) {
    await db.schema.createTable('zabbix_discovered_hosts', (t) => {
      t.increments('id').primary();
      t.integer('integration_id').unsigned().references('id').inTable('zabbix_integrations').onDelete('CASCADE');
      t.string('host_id', 80).notNullable();
      t.string('host_name', 200).notNullable();
      t.string('display_name', 200).defaultTo('');
      t.string('ip_address', 80).defaultTo('');
      t.string('zabbix_type', 40).defaultTo('');
      t.string('ci_type_code', 40).defaultTo('');
      t.string('reason', 300).defaultTo('');
      t.string('status', 30).notNullable().defaultTo('pending');
      t.text('payload');
      t.integer('ci_id').unsigned();
      t.string('first_seen_at', 40).notNullable();
      t.string('last_seen_at', 40).notNullable();
      t.string('created_at', 40).notNullable();
      t.string('updated_at', 40).notNullable();
      t.unique(['integration_id', 'host_id']);
      t.index(['status']);
    });
  }
  if (!(await db.schema.hasTable('zabbix_type_mappings'))) {
    await db.schema.createTable('zabbix_type_mappings', (t) => {
      t.increments('id').primary();
      t.string('zabbix_value', 120).notNullable().unique();
      t.integer('ci_type_id').unsigned().notNullable().references('id').inTable('ci_types').onDelete('CASCADE');
      t.string('description', 300).defaultTo('');
      t.boolean('enabled').notNullable().defaultTo(true);
      t.string('created_at', 40).notNullable();
      t.string('updated_at', 40).notNullable();
      t.index(['ci_type_id']);
      t.index(['enabled']);
    });
  }
  const rackableAdded = await addColumn('ci_types', 'rackable', (t) => t.boolean('rackable').notNullable().defaultTo(false));
  if (rackableAdded) {
    await db('ci_types').whereIn('code', ['server', 'network', 'security']).update({ rackable: true });
    console.log('[db] enabled rack placement for server / network / security types');
  }
  await addColumn('cis', 'bmc_address', (t) => t.string('bmc_address', 120).defaultTo(''));

  if (!(await db.schema.hasTable('ci_relation_types'))) {
    await db.schema.createTable('ci_relation_types', (t) => {
      t.increments('id').primary();
      t.string('code', 40).notNullable().unique();
      t.string('name', 120).notNullable();
      t.string('reverse_name', 120).notNullable();
      t.integer('from_type_id').unsigned().references('id').inTable('ci_types').onDelete('SET NULL');
      t.integer('to_type_id').unsigned().references('id').inTable('ci_types').onDelete('SET NULL');
      t.string('color', 20).defaultTo('#4f6ef7');
      t.string('description', 300).defaultTo('');
      t.boolean('builtin').notNullable().defaultTo(false);
      t.boolean('enabled').notNullable().defaultTo(true);
      t.integer('sort_order').notNullable().defaultTo(0);
      t.string('created_at', 40).notNullable();
      t.string('updated_at', 40).notNullable();
    });
  }
  if (!(await db.schema.hasTable('rack_profiles'))) {
    await db.schema.createTable('rack_profiles', (t) => {
      t.increments('id').primary();
      t.integer('ci_id').unsigned().notNullable().unique().references('id').inTable('cis').onDelete('CASCADE');
      t.integer('datacenter_id').unsigned().references('id').inTable('cis').onDelete('SET NULL');
      t.integer('capacity_u').notNullable().defaultTo(47);
      t.string('numbering', 30).notNullable().defaultTo('bottom_up');
      t.string('notes', 300).defaultTo('');
      t.string('created_at', 40).notNullable();
      t.string('updated_at', 40).notNullable();
    });
  }
  if (!(await db.schema.hasTable('rack_placements'))) {
    await db.schema.createTable('rack_placements', (t) => {
      t.increments('id').primary();
      t.integer('rack_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
      t.integer('ci_id').unsigned().notNullable().unique().references('id').inTable('cis').onDelete('CASCADE');
      t.integer('start_u').notNullable();
      t.integer('u_height').notNullable().defaultTo(1);
      t.string('side', 20).notNullable().defaultTo('front');
      t.string('notes', 300).defaultTo('');
      t.string('created_at', 40).notNullable();
      t.string('updated_at', 40).notNullable();
      t.index(['rack_id']);
    });
  }
  if (!(await db.schema.hasTable('rack_blank_units'))) {
    await db.schema.createTable('rack_blank_units', (t) => {
      t.increments('id').primary();
      t.integer('rack_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
      t.integer('start_u').notNullable();
      t.integer('u_height').notNullable().defaultTo(1);
      t.string('notes', 300).defaultTo('');
      t.string('created_at', 40).notNullable();
      t.string('updated_at', 40).notNullable();
      t.index(['rack_id']);
      t.index(['start_u']);
    });
  }
  if (!(await db.schema.hasTable('ci_network_ports'))) {
    await db.schema.createTable('ci_network_ports', (t) => {
      t.increments('id').primary();
      t.integer('ci_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
      t.string('port_name', 80).notNullable();
      t.string('port_type', 30).notNullable().defaultTo('ethernet');
      t.string('mac_address', 80).defaultTo('');
      t.integer('speed_mbps').defaultTo(0);
      t.integer('current_speed_mbps').defaultTo(0);
      t.integer('connected_switch_id').unsigned().references('id').inTable('cis').onDelete('SET NULL');
      t.string('connected_switch_port', 120).defaultTo('');
      t.string('link_status', 20).notNullable().defaultTo('unknown');
      t.string('source', 30).notNullable().defaultTo('manual');
      t.string('last_synced_at', 40);
      t.string('notes', 300).defaultTo('');
      t.string('created_at', 40).notNullable();
      t.string('updated_at', 40).notNullable();
      t.unique(['ci_id', 'port_name']);
    });
  }
  if (!(await db.schema.hasTable('ticket_deletion_requests'))) {
    await db.schema.createTable('ticket_deletion_requests', (t) => {
      t.increments('id').primary();
      t.integer('ticket_id').unsigned().references('id').inTable('tickets').onDelete('SET NULL');
      t.string('ticket_no', 60).notNullable();
      t.string('ticket_type', 30).notNullable();
      t.string('ticket_title', 240).notNullable();
      t.integer('requested_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      t.text('reason').notNullable();
      t.string('status', 30).notNullable().defaultTo('pending');
      t.integer('reviewed_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      t.text('review_comment');
      t.string('created_at', 40).notNullable();
      t.string('reviewed_at', 40);
      t.index(['status']);
    });
  }
  if (!(await db.schema.hasTable('deletion_policies'))) {
    await db.schema.createTable('deletion_policies', (t) => {
      t.increments('id').primary();
      t.text('approver_role_ids').notNullable().defaultTo('[]');
      t.integer('updated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      t.string('updated_at', 40).notNullable();
    });
  }
  if (!(await db.schema.hasTable('system_settings'))) {
    await db.schema.createTable('system_settings', (t) => {
      t.increments('id').primary();
      t.string('setting_key', 80).notNullable().unique();
      t.text('setting_value');
      t.string('updated_at', 40).notNullable();
    });
  }
  if (!(await db.schema.hasTable('maintenance_notices'))) {
    await db.schema.createTable('maintenance_notices', (t) => {
      t.increments('id').primary();
      t.string('title', 200).notNullable();
      t.text('content').notNullable();
      t.string('start_at', 40).notNullable();
      t.string('end_at', 40).notNullable();
      t.string('status', 30).notNullable().defaultTo('planned');
      t.boolean('notify_users').notNullable().defaultTo(false);
      t.string('notified_at', 40);
      t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      t.string('created_at', 40).notNullable();
      t.string('updated_at', 40).notNullable();
      t.index(['start_at']);
      t.index(['status']);
    });
  }
  if (!(await db.schema.hasTable('ci_deletion_requests'))) {
    await db.schema.createTable('ci_deletion_requests', (t) => {
      t.increments('id').primary();
      t.integer('ci_id').unsigned().references('id').inTable('cis').onDelete('SET NULL');
      t.string('ci_asset_no', 120).notNullable();
      t.string('ci_name', 200).notNullable();
      t.string('ci_type_name', 120).defaultTo('');
      t.integer('requester_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
      t.string('reason', 500).defaultTo('');
      t.string('status', 30).notNullable().defaultTo('pending');
      t.integer('reviewed_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      t.string('review_comment', 500).defaultTo('');
      t.text('snapshot');
      t.string('created_at', 40).notNullable();
      t.string('updated_at', 40).notNullable();
      t.index(['status']);
      t.index(['ci_id']);
    });
  }
  if (!(await db.schema.hasTable('datacenter_links'))) {
    await db.schema.createTable('datacenter_links', (t) => {
      t.increments('id').primary();
      t.integer('source_dc_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
      t.integer('target_dc_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
      t.string('name', 160).defaultTo('');
      t.string('carrier', 80).defaultTo('');
      t.integer('bandwidth_mbps').notNullable().defaultTo(0);
      t.string('status', 30).notNullable().defaultTo('up');
      t.string('source', 30).notNullable().defaultTo('manual');
      t.integer('zabbix_ci_id').unsigned().references('id').inTable('cis').onDelete('SET NULL');
      t.string('zabbix_metric', 160).defaultTo('');
      t.string('notes', 300).defaultTo('');
      t.string('created_at', 40).notNullable();
      t.string('updated_at', 40).notNullable();
      t.unique(['source_dc_id', 'target_dc_id', 'name']);
      t.index(['source_dc_id']);
      t.index(['target_dc_id']);
    });
  }

  if (!(await db.schema.hasTable('notification_channels'))) {
    await db.schema.createTable('notification_channels', (t) => {
      t.increments('id').primary();
      t.string('type', 30).notNullable().unique();
      t.string('name', 100).notNullable();
      t.boolean('enabled').notNullable().defaultTo(false);
      t.text('events');
      t.text('config');
      t.string('last_test_at', 40);
      t.string('last_test_status', 30);
      t.string('created_at', 40).notNullable();
      t.string('updated_at', 40).notNullable();
    });
  }
  if (!(await db.schema.hasTable('notification_logs'))) {
    await db.schema.createTable('notification_logs', (t) => {
      t.increments('id').primary();
      t.integer('channel_id').unsigned().references('id').inTable('notification_channels').onDelete('SET NULL');
      t.string('channel_type', 30).notNullable();
      t.string('channel_name', 100).defaultTo('');
      t.string('event_type', 60).notNullable();
      t.integer('ticket_id').unsigned().references('id').inTable('tickets').onDelete('SET NULL');
      t.string('target', 500).defaultTo('');
      t.string('title', 300).defaultTo('');
      t.text('content');
      t.string('status', 20).notNullable().defaultTo('success');
      t.text('error');
      t.string('created_at', 40).notNullable();
      t.index(['created_at']);
      t.index(['channel_type']);
      t.index(['ticket_id']);
    });
  }

  await addColumn('users', 'allowed_ips', (t) => t.string('allowed_ips', 500).defaultTo(''));
  await addColumn('users', 'bound_mac', (t) => t.string('bound_mac', 80).defaultTo(''));
  await addColumn('cis', 'asset_manager_id', (t) => t.integer('asset_manager_id').unsigned().references('id').inTable('users').onDelete('SET NULL'));

  if (!(await db.schema.hasTable('ci_change_logs'))) {
    await db.schema.createTable('ci_change_logs', (t) => {
      t.increments('id').primary();
      t.integer('ci_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
      t.string('action', 40).notNullable();
      t.text('changes').defaultTo('{}');
      t.string('source', 30).notNullable().defaultTo('manual');
      t.integer('ticket_id').unsigned();
      t.integer('actor_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
      t.string('created_at', 40).notNullable();
      t.index(['ci_id']);
      t.index(['ticket_id']);
    });
  }
  if (!(await db.schema.hasTable('ci_acl'))) {
    await db.schema.createTable('ci_acl', (t) => {
      t.increments('id').primary();
      t.integer('ci_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
      t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.boolean('can_view').notNullable().defaultTo(true);
      t.boolean('can_edit').notNullable().defaultTo(false);
      t.string('created_at', 40).notNullable();
      t.unique(['ci_id', 'user_id']);
    });
  }
  if (!(await db.schema.hasTable('ci_ips'))) {
    await db.schema.createTable('ci_ips', (t) => {
      t.increments('id').primary();
      t.integer('ci_id').unsigned().notNullable().references('id').inTable('cis').onDelete('CASCADE');
      t.string('ip_address', 80).notNullable();
      t.string('interface_name', 80).defaultTo('');
      t.string('status', 30).notNullable().defaultTo('active');
      t.string('source', 30).notNullable().defaultTo('manual');
      t.string('last_seen_at', 40);
      t.string('released_at', 40);
      t.string('created_at', 40).notNullable();
      t.index(['ip_address']);
      t.index(['ci_id']);
    });
  }
  if (!(await db.schema.hasTable('ip_assets'))) {
    await db.schema.createTable('ip_assets', (t) => {
      t.increments('id').primary();
      t.string('ip_address', 80).notNullable().unique();
      t.string('status', 30).notNullable().defaultTo('in_use');
      t.string('owner', 120).defaultTo('');
      t.string('notes', 500).defaultTo('');
      t.integer('ci_id').unsigned().references('id').inTable('cis').onDelete('SET NULL');
      t.string('created_at', 40).notNullable();
      t.string('updated_at', 40).notNullable();
    });
  } else {
    await addColumn('ip_assets', 'ci_id', (t) => t.integer('ci_id').unsigned().references('id').inTable('cis').onDelete('SET NULL'));
  }
  if (!(await db.schema.hasTable('ip_assignment_history'))) {
    await db.schema.createTable('ip_assignment_history', (t) => {
      t.increments('id').primary();
      t.string('ip_address', 80).notNullable();
      t.string('action', 40).notNullable();
      t.string('previous_asset_no', 120).defaultTo('');
      t.string('previous_owner', 120).defaultTo('');
      t.string('previous_notes', 500).defaultTo('');
      t.integer('new_ci_id').unsigned().references('id').inTable('cis').onDelete('SET NULL');
      t.string('new_asset_no', 120).defaultTo('');
      t.integer('actor_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
      t.string('created_at', 40).notNullable();
      t.index(['ip_address']);
    });
  }
  if (!(await db.schema.hasTable('ip_subnets'))) {
    await db.schema.createTable('ip_subnets', (t) => {
      t.increments('id').primary();
      t.string('subnet', 80).notNullable().unique();
      t.string('label', 120).defaultTo('');
      t.string('vlan', 60).defaultTo('');
      t.string('notes', 500).defaultTo('');
      t.string('updated_at', 40).notNullable();
    });
  }
  if (!(await db.schema.hasTable('rich_attachments'))) {
    await db.schema.createTable('rich_attachments', (t) => {
      t.increments('id').primary();
      t.string('token', 100).notNullable().unique();
      t.string('filename', 300).notNullable();
      t.string('stored_name', 300).notNullable();
      t.string('mime_type', 160).defaultTo('application/octet-stream');
      t.integer('size').defaultTo(0);
      t.integer('uploaded_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      t.string('created_at', 40).notNullable();
    });
  }
  if (!(await db.schema.hasTable('ticket_attachments'))) {
    await db.schema.createTable('ticket_attachments', (t) => {
      t.increments('id').primary();
      t.integer('ticket_id').unsigned().notNullable().references('id').inTable('tickets').onDelete('CASCADE');
      t.integer('comment_id').unsigned().references('id').inTable('ticket_comments').onDelete('SET NULL');
      t.string('filename', 300).notNullable();
      t.string('stored_name', 300).notNullable();
      t.string('mime_type', 160).defaultTo('application/octet-stream');
      t.integer('size').defaultTo(0);
      t.integer('uploaded_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      t.string('created_at', 40).notNullable();
      t.index(['ticket_id']);
    });
  }

  if (await db.schema.hasTable('system_meta')) {
    const existing = await db('system_meta').where({ meta_key: 'schema_version' }).first();
    if (existing) await db('system_meta').where({ meta_key: 'schema_version' }).update({ meta_value: '2' });
    else await db('system_meta').insert({ meta_key: 'schema_version', meta_value: '2' });
  }
}
