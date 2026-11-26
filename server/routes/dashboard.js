import { db } from '../db/index.js';
import { authenticate, hasPermission } from '../lib/auth.js';
import { nowIso } from '../lib/helpers.js';

function scoped(query, user, table = 'tickets') {
  if (user.role?.code === 'employee') {
    query.where((builder) => builder.where(`${table}.requester_id`, user.id).orWhere(`${table}.assignee_id`, user.id));
  }
  return query;
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

function dayKey(value) {
  return String(value || '').slice(0, 10);
}

export default async function dashboardRoutes(app) {
  app.get('/api/dashboard/summary', { preHandler: authenticate }, async (request) => {
    const user = request.auth;
    const ts = nowIso();
    const count = async (builder) => Number((await builder.count({ count: '*' }).first())?.count || 0);

    const totalCis = await count(db('cis'));
    const criticalCis = await count(db('cis').where({ criticality: 'critical' }));
    const openIncidents = await count(scoped(db('tickets').where({ type: 'incident' }).whereNotIn('status', ['closed', 'cancelled', 'resolved']), user));
    const openProblems = await count(scoped(db('tickets').where({ type: 'problem' }).whereNotIn('status', ['closed', 'cancelled', 'resolved']), user));
    const pendingApprovals = await count(scoped(db('tickets').where({ status: 'pending_approval' }), user));
    const overdue = await count(
      scoped(
        db('tickets').whereNotIn('status', ['closed', 'cancelled', 'resolved']).where('sla_due_at', '<', ts),
        user,
      ),
    );
    const zabbix24h = await count(db('zabbix_events').where('received_at', '>', daysFromNow(-1)));
    const resolved30 = await scoped(
      db('tickets')
        .where({ type: 'incident' })
        .whereNotNull('resolved_at')
        .where('created_at', '>', daysFromNow(-30)),
      user,
    ).select('created_at', 'resolved_at');
    const mttrHours = resolved30.length
      ? Math.round(
          (resolved30.reduce((sum, row) => sum + (new Date(row.resolved_at).getTime() - new Date(row.created_at).getTime()), 0) /
            resolved30.length /
            3600000) *
            10,
        ) / 10
      : 0;

    const byType = await db('cis')
      .leftJoin('ci_types', 'cis.ci_type_id', 'ci_types.id')
      .select('ci_types.id', 'ci_types.name', 'ci_types.code', 'ci_types.color', 'ci_types.icon')
      .count({ count: 'cis.id' })
      .groupBy('ci_types.id', 'ci_types.name', 'ci_types.code', 'ci_types.color', 'ci_types.icon')
      .orderBy('ci_types.sort_order');

    const statusRows = await scoped(db('tickets'), user)
      .select('status')
      .count({ count: '*' })
      .groupBy('status');
    const typeRows = await scoped(db('tickets'), user)
      .select('type')
      .count({ count: '*' })
      .groupBy('type');
    const priorityRows = await scoped(
      db('tickets').whereNotIn('status', ['closed', 'cancelled', 'resolved']),
      user,
    )
      .select('priority')
      .count({ count: '*' })
      .groupBy('priority');

    const trendStart = new Date();
    trendStart.setHours(0, 0, 0, 0);
    trendStart.setDate(trendStart.getDate() - 13);
    const trendRows = await scoped(db('tickets').where('created_at', '>=', trendStart.toISOString()), user).select(
      'type',
      'created_at',
    );
    const trend = [];
    for (let i = 0; i < 14; i += 1) {
      const date = new Date(trendStart);
      date.setDate(date.getDate() + i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      trend.push({
        date: key,
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        incident: 0,
        problem: 0,
        change: 0,
      });
    }
    const trendMap = Object.fromEntries(trend.map((item) => [item.date, item]));
    for (const row of trendRows) {
      const key = dayKey(row.created_at);
      if (trendMap[key]) trendMap[key][row.type] += 1;
    }

    const recentTickets = await scoped(
      db('tickets')
        .leftJoin('users as assignee', 'tickets.assignee_id', 'assignee.id')
        .leftJoin('users as requester', 'tickets.requester_id', 'requester.id'),
      user,
    )
      .select(
        'tickets.id',
        'tickets.ticket_no',
        'tickets.title',
        'tickets.type',
        'tickets.status',
        'tickets.priority',
        'tickets.updated_at',
        'tickets.sla_due_at',
        'assignee.name as assignee_name',
        'requester.name as requester_name',
      )
      .orderBy('tickets.updated_at', 'desc')
      .limit(6);

    const myTasks = await db('tickets')
      .leftJoin('workflow_stages', 'tickets.current_stage_id', 'workflow_stages.id')
      .where((builder) => builder.where('tickets.assignee_id', user.id).orWhere('tickets.requester_id', user.id))
      .whereNotIn('tickets.status', ['closed', 'cancelled'])
      .select(
        'tickets.id',
        'tickets.ticket_no',
        'tickets.title',
        'tickets.type',
        'tickets.status',
        'tickets.priority',
        'tickets.sla_due_at',
        'workflow_stages.name as stage_name',
      )
      .orderByRaw("case tickets.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end")
      .limit(6);

    const attention = await scoped(
      db('tickets')
        .whereNotIn('tickets.status', ['closed', 'cancelled'])
        .where((builder) => builder.where('tickets.sla_due_at', '<', ts).orWhere('tickets.status', 'pending_approval')),
      user,
    )
      .select('tickets.id', 'tickets.ticket_no', 'tickets.title', 'tickets.type', 'tickets.status', 'tickets.priority', 'tickets.sla_due_at')
      .orderBy('tickets.sla_due_at')
      .limit(5);

    const changes = await scoped(
      db('tickets').where({ type: 'change' }).whereNotIn('status', ['closed', 'cancelled']).whereNotNull('planned_start'),
      user,
    )
      .select('tickets.id', 'tickets.ticket_no', 'tickets.title', 'tickets.status', 'tickets.planned_start', 'tickets.planned_end', 'tickets.risk', 'tickets.change_type')
      .orderBy('tickets.planned_start')
      .limit(6);

    const alerts = await db('zabbix_events')
      .leftJoin('tickets', 'zabbix_events.ticket_id', 'tickets.id')
      .select(
        'zabbix_events.id',
        'zabbix_events.event_name',
        'zabbix_events.host_name',
        'zabbix_events.severity',
        'zabbix_events.event_status',
        'zabbix_events.received_at',
        'zabbix_events.processing_status',
        'tickets.ticket_no',
        'tickets.id as ticket_id',
      )
      .whereRaw("upper(zabbix_events.event_status) not in ('RESOLVED', 'RECOVERY')")
      .orderBy('zabbix_events.received_at', 'desc')
      .limit(5);

    const activity = hasPermission(user, 'system.audit_view')
      ? await db('audit_logs').select('id', 'actor_name', 'action', 'summary', 'entity_type', 'entity_id', 'created_at').orderBy('created_at', 'desc').limit(7)
      : [];

    return {
      metrics: {
        totalCis,
        criticalCis,
        openIncidents,
        openProblems,
        pendingApprovals,
        overdue,
        zabbix24h,
        mttrHours,
      },
      byType: byType.map((row) => ({ ...row, count: Number(row.count) })),
      byStatus: Object.fromEntries(statusRows.map((row) => [row.status, Number(row.count)])),
      byPriority: Object.fromEntries(priorityRows.map((row) => [row.priority, Number(row.count)])),
      byTicketType: Object.fromEntries(typeRows.map((row) => [row.type, Number(row.count)])),
      trend,
      recentTickets,
      myTasks,
      attention,
      changes,
      alerts,
      activity,
    };
  });
}
