import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { db, insertReturningId } from '../db/index.js';
import { authenticate, hasPermission, requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { addHours, httpError, nowIso, paginate, parseJson } from '../lib/helpers.js';
import { queueTicketNotification } from '../services/notifications.js';
import { ensureUploadDir, UPLOAD_DIR } from '../lib/uploads.js';

const TYPE_PREFIX = { incident: 'INC', problem: 'PRB', change: 'CHG' };
const CLOSED_STATUSES = new Set(['closed', 'cancelled']);

function sanitizeRichText(input) {  return String(input || '')
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/\s(href|src)\s*=\s*(["'])(?!(?:https?:\/\/|\/api\/rich-attachments\/public\/|\/uploads\/))[^"']*\2/gi, '')
    .replace(/<(?!\/?(?:b|strong|i|em|u|p|br|ul|ol|li|a|img|blockquote|h[1-3])\b)[^>]*>/gi, '');
}

async function resolveLinkedZabbixEvents(ticketId) {
  await db('zabbix_events')
    .where({ ticket_id: ticketId })
    .whereRaw("upper(event_status) <> 'RESOLVED'")
    .update({ event_status: 'RESOLVED', processing_status: 'ticket_closed', processing_note: '关联工单已关闭，告警自动恢复' });
}


async function canAccessCI(auth, ci) {
  if (auth.role?.code === 'admin' || !ci?.asset_manager_id) return true;
  if (Number(ci.asset_manager_id) === Number(auth.id)) return true;
  const grant = await db('ci_acl').where({ ci_id: ci.id, user_id: auth.id }).first();
  return Boolean(grant?.can_view || grant?.can_edit);
}

const ticketBase = () =>
  db('tickets')
    .leftJoin('users as assignee', 'tickets.assignee_id', 'assignee.id')
    .leftJoin('users as requester', 'tickets.requester_id', 'requester.id')
    .leftJoin('workflow_stages as stage', 'tickets.current_stage_id', 'stage.id')
    .leftJoin('workflows', 'tickets.workflow_id', 'workflows.id');

const ticketSelect = [
  'tickets.*',
  'assignee.name as assignee_name',
  'assignee.avatar_color as assignee_color',
  'assignee.avatar_url as assignee_avatar_url',
  'requester.name as requester_name',
  'requester.department as requester_department',
  'requester.avatar_color as requester_color',
  'requester.avatar_url as requester_avatar_url',
  'stage.name as stage_name',
  'stage.stage_type as stage_type',
  'stage.color as stage_color',
  'workflows.name as workflow_name',
];

function scopeForUser(query, user) {
  if (user.role?.code === 'employee') {
    query.where((builder) => builder.where('tickets.requester_id', user.id).orWhere('tickets.assignee_id', user.id));
  }
  return query;
}

function applyFilters(query, filters, user) {
  scopeForUser(query, user);
  if (filters.type) query.where('tickets.type', filters.type);
  if (filters.status) {
    const statuses = String(filters.status).split(',').filter(Boolean);
    if (statuses.length) query.whereIn('tickets.status', statuses);
  }
  if (filters.priority) query.where('tickets.priority', filters.priority);
  if (filters.assignee_id) query.where('tickets.assignee_id', Number(filters.assignee_id));
  if (filters.requester_id === 'me') query.where('tickets.requester_id', user.id);
  else if (filters.requester_id) query.where('tickets.requester_id', Number(filters.requester_id));
  if (filters.scope === 'mine') {
    query.where((builder) => builder.where('tickets.requester_id', user.id).orWhere('tickets.assignee_id', user.id));
  }
  if (filters.workflow_id) query.where('tickets.workflow_id', Number(filters.workflow_id));
  if (filters.source) query.where('tickets.source', filters.source);
  if (filters.ci_id) {
    query.whereExists(
      db('ticket_cis')
        .select(db.raw('1'))
        .whereRaw('ticket_cis.ticket_id = tickets.id')
        .where('ticket_cis.ci_id', Number(filters.ci_id)),
    );
  }
  if (filters.q) {
    const term = `%${filters.q}%`;
    query.where((builder) =>
      builder
        .where('tickets.title', 'like', term)
        .orWhere('tickets.ticket_no', 'like', term)
        .orWhere('tickets.description', 'like', term)
        .orWhere('requester.name', 'like', term),
    );
  }
  if (filters.overdue === 'true') {
    query.whereNotIn('tickets.status', ['closed', 'cancelled', 'resolved']).where('tickets.sla_due_at', '<', nowIso());
  }
  if (filters.deletion === 'pending') {
    query.whereExists(
      db('ticket_deletion_requests')
        .select(db.raw('1'))
        .whereRaw('ticket_deletion_requests.ticket_id = tickets.id')
        .where('ticket_deletion_requests.status', 'pending'),
    );
  }
  return query;
}

function decorateTicket(row) {
  if (!row) return row;
  const open = !CLOSED_STATUSES.has(row.status) && row.status !== 'resolved';
  return {
    ...row,
    is_overdue: Boolean(open && row.sla_due_at && new Date(row.sla_due_at).getTime() < Date.now()),
  };
}

async function canViewTicket(ticket, user) {
  if (user.role?.code !== 'employee') return true;
  return ticket.requester_id === user.id || ticket.assignee_id === user.id;
}

async function getWorkflow(type, workflowId) {
  const query = db('workflows').where({ ticket_type: type, is_active: true });
  if (workflowId) query.where({ id: workflowId });
  else query.where({ is_default: true });
  let workflow = await query.first();
  if (!workflow && !workflowId) {
    workflow = await db('workflows').where({ ticket_type: type, is_active: true }).orderBy('id').first();
  }
  if (!workflow) return null;
  const stages = await db('workflow_stages').where({ workflow_id: workflow.id }).orderBy('seq');
  return { ...workflow, stages };
}

async function ticketDetail(id) {
  const ticket = await ticketBase().select(ticketSelect).where('tickets.id', id).first();
  if (!ticket) return null;
  const comments = await db('ticket_comments')
    .leftJoin('users', 'ticket_comments.user_id', 'users.id')
    .select(
      'ticket_comments.*',
      'users.name as user_name',
      'users.avatar_color as user_color',
      'users.avatar_url as user_avatar_url',
      'users.department as user_department',
    )
    .where({ ticket_id: id })
    .orderBy('ticket_comments.created_at');
  const attachments = await db('ticket_attachments')
    .leftJoin('users', 'ticket_attachments.uploaded_by', 'users.id')
    .select('ticket_attachments.*', 'users.name as uploader_name')
    .where('ticket_id', id)
    .orderBy('ticket_attachments.created_at');
  const history = await db('ticket_stage_history')
    .leftJoin('users', 'ticket_stage_history.actor_id', 'users.id')
    .select(
      'ticket_stage_history.*',
      'users.name as actor_name',
      'users.avatar_color as actor_color',
      'users.avatar_url as actor_avatar_url',
    )
    .where({ ticket_id: id })
    .orderBy('ticket_stage_history.created_at');
  const cis = await db('ticket_cis')
    .join('cis', 'ticket_cis.ci_id', 'cis.id')
    .leftJoin('ci_types', 'cis.ci_type_id', 'ci_types.id')
    .select(
      'cis.id',
      'cis.asset_no',
      'cis.name',
      'cis.status',
      'cis.criticality',
      'cis.ip_address',
      'cis.location',
      'ci_types.name as type_name',
      'ci_types.color as type_color',
    )
    .where('ticket_cis.ticket_id', id);
  const related = await db('ticket_relations')
    .leftJoin('tickets as linked', 'ticket_relations.linked_ticket_id', 'linked.id')
    .select(
      'ticket_relations.*',
      'linked.ticket_no as linked_ticket_no',
      'linked.title as linked_title',
      'linked.status as linked_status',
      'linked.type as linked_type',
    )
    .where('ticket_relations.ticket_id', id);
  const incoming = await db('ticket_relations')
    .leftJoin('tickets as source', 'ticket_relations.ticket_id', 'source.id')
    .select(
      'ticket_relations.*',
      'source.ticket_no as linked_ticket_no',
      'source.title as linked_title',
      'source.status as linked_status',
      'source.type as linked_type',
    )
    .where('ticket_relations.linked_ticket_id', id);
  const workflowStages = ticket.workflow_id
    ? await db('workflow_stages').where({ workflow_id: ticket.workflow_id }).orderBy('seq')
    : [];
  const deletionRequest = await db('ticket_deletion_requests')
    .leftJoin('users as requester', 'ticket_deletion_requests.requested_by', 'requester.id')
    .leftJoin('users as reviewer', 'ticket_deletion_requests.reviewed_by', 'reviewer.id')
    .select(
      'ticket_deletion_requests.*',
      'requester.name as requester_name',
      'reviewer.name as reviewer_name',
    )
    .where('ticket_deletion_requests.ticket_id', id)
    .orderBy('ticket_deletion_requests.created_at', 'desc')
    .first();
  return {
    ...decorateTicket(ticket),
    comments,
    attachments,
    history,
    cis,
    relations: related,
    incoming_relations: incoming,
    stages: workflowStages,
    deletion_request: deletionRequest || null,
  };
}

export default async function ticketRoutes(app) {
  app.get('/api/tickets', { preHandler: [authenticate, requirePermission('itsm.view')] }, async (request) => {
    const { page, pageSize, limit, offset } = paginate(request.query);
    const countQuery = applyFilters(ticketBase(), request.query, request.auth);
    const totalRow = await countQuery.clone().clearSelect().count({ count: 'tickets.id' }).first();
    const query = applyFilters(ticketBase(), request.query, request.auth);
    const sortMap = {
      ticket_no: 'tickets.ticket_no', title: 'tickets.title', status: 'tickets.status', priority: 'tickets.priority',
      assignee_name: 'assignee.name', requester_name: 'requester.name', stage_name: 'stage.name',
      sla_due_at: 'tickets.sla_due_at', created_at: 'tickets.created_at', updated_at: 'tickets.updated_at',
    };
    const sort = sortMap[request.query.sortBy] || 'tickets.ticket_no';
    const sortDir = String(request.query.sortDir).toLowerCase() === 'asc' ? 'asc' : 'desc';
    const rows = await query
      .select(ticketSelect)
      .orderBy(sort, sortDir)
      .limit(limit)
      .offset(offset);
    const ticketIds = rows.map((row) => row.id);
    const deletionRows = ticketIds.length
      ? await db('ticket_deletion_requests')
          .leftJoin('users as requester', 'ticket_deletion_requests.requested_by', 'requester.id')
          .select('ticket_deletion_requests.*', 'requester.name as requester_name')
          .whereIn('ticket_deletion_requests.ticket_id', ticketIds)
          .where('ticket_deletion_requests.status', 'pending')
      : [];
    const deletionMap = new Map(deletionRows.map((row) => [row.ticket_id, row]));
    return {
      data: rows.map((row) => ({ ...decorateTicket(row), deletion_request: deletionMap.get(row.id) || null })),
      pagination: { page, pageSize, total: Number(totalRow?.count || 0) },
    };
  });

  app.get('/api/tickets/stats', { preHandler: [authenticate, requirePermission('itsm.view')] }, async (request) => {
    const query = scopeForUser(db('tickets'), request.auth);
    if (request.query.type) query.where('tickets.type', request.query.type);
    if (request.query.scope === 'mine') {
      query.where((builder) => builder.where('tickets.requester_id', request.auth.id).orWhere('tickets.assignee_id', request.auth.id));
    }
    const statusRows = await query.clone().select('status').count({ count: '*' }).groupBy('status');
    const byStatus = Object.fromEntries(statusRows.map((row) => [row.status, Number(row.count)]));
    const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0);
    const overdue = Number(
      (
        await query
          .clone()
          .whereNotIn('tickets.status', ['closed', 'cancelled', 'resolved'])
          .where('tickets.sla_due_at', '<', nowIso())
          .count({ count: '*' })
          .first()
      )?.count || 0,
    );
    const mine = Number(
      (
        await db('tickets')
          .where({ type: request.query.type || 'incident' })
          .where((builder) => builder.where('requester_id', request.auth.id).orWhere('assignee_id', request.auth.id))
          .whereNotIn('status', ['closed', 'cancelled'])
          .count({ count: '*' })
          .first()
      )?.count || 0,
    );
    return {
      total,
      by_status: byStatus,
      open: total - (byStatus.closed || 0) - (byStatus.cancelled || 0),
      pending_approval: byStatus.pending_approval || 0,
      overdue,
      mine,
    };
  });

  app.get('/api/tickets/:id', { preHandler: [authenticate, requirePermission('itsm.view')] }, async (request, reply) => {
    const data = await ticketDetail(Number(request.params.id));
    if (!data) return reply.code(404).send({ message: '工单不存在' });
    if (!(await canViewTicket(data, request.auth))) return reply.code(403).send({ message: '无权查看该工单' });
    if (request.auth.role?.code === 'employee') {
      data.comments = data.comments.filter((comment) => !comment.is_internal);
    }
    return {
      data,
      permissions: {
        can_edit: hasPermission(request.auth, 'itsm.edit'),
        can_approve: hasPermission(request.auth, 'itsm.approve'),
        can_manage: request.auth.role?.code === 'admin',
        can_request_delete: hasPermission(request.auth, 'itsm.view'),
      },
    };
  });

  app.post('/api/tickets', { preHandler: [authenticate, requirePermission('itsm.create', 'itsm.edit')] }, async (request, reply) => {
    const schema = z.object({
      type: z.enum(['incident', 'problem', 'change']),
      title: z.string().trim().min(3, '标题至少 3 个字'),
      description: z.string().default(''),
      priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
      impact: z.enum(['high', 'medium', 'low']).default('medium'),
      urgency: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
      category: z.string().default(''),
      source: z.string().trim().max(80).default('portal'),
      workflow_id: z.coerce.number().int().positive().optional(),
      assignee_id: z.coerce.number().int().positive().nullable().optional(),
      ci_ids: z.array(z.coerce.number().int().positive()).default([]),
      root_cause: z.string().default(''),
      workaround: z.string().default(''),
      risk: z.enum(['high', 'medium', 'low']).default('medium'),
      change_type: z.enum(['standard', 'normal', 'emergency']).default('normal'),
      planned_start: z.string().default(''),
      planned_end: z.string().default(''),
      implementation_plan: z.string().default(''),
      rollback_plan: z.string().default(''),
      test_plan: z.string().default(''),
      cab_date: z.string().default(''),
      outage_required: z.boolean().default(false),
      change_updates: z.array(z.object({
        ci_id: z.coerce.number().int().positive(),
        field_key: z.string().trim().min(1).max(120),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]).default(''),
      })).max(200).default([]),
    });
    const body = schema.parse(request.body || {});
    body.description = sanitizeRichText(body.description);
    if (body.type === 'change' && body.ci_ids.length === 0) {
      return reply.code(400).send({ message: '变更必须关联至少一个 CI 配置项' });
    }
    const workflow = await getWorkflow(body.type, body.workflow_id);
    if (!workflow || !workflow.stages.length) {
      return reply.code(400).send({ message: '所选类型没有可用的流转流程，请先在流程设计中配置' });
    }
    const firstStage = workflow.stages[0];
    const ts = nowIso();
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const uniqueCiIds = [...new Set(body.ci_ids)];
    if (uniqueCiIds.length) {
      const found = await db('cis').whereIn('id', uniqueCiIds).select('id');
      if (found.length !== uniqueCiIds.length) return reply.code(400).send({ message: '部分关联 CI 不存在' });
    }
    const id = await db.transaction(async (trx) => {
      const placeholder = `TMP-${crypto.randomUUID()}`;
      const ticketId = await insertReturningId(trx('tickets'), {
        ticket_no: placeholder,
        type: body.type,
        title: body.title,
        description: body.description,
        status: firstStage.stage_type === 'approval' ? 'pending_approval' : 'new',
        priority: body.priority,
        impact: body.impact,
        urgency: body.urgency,
        category: body.category,
        source: body.source,
        requester_id: request.auth.id,
        assignee_id: body.assignee_id || null,
        workflow_id: workflow.id,
        current_stage_id: firstStage.id,
        resolution: '',
        sla_due_at: addHours(ts, firstStage.sla_hours),
        risk: body.risk,
        change_type: body.change_type,
        planned_start: body.planned_start,
        planned_end: body.planned_end,
        implementation_plan: body.implementation_plan,
        rollback_plan: body.rollback_plan,
        test_plan: body.test_plan,
        cab_date: body.cab_date,
        outage_required: body.outage_required,
        change_updates: JSON.stringify(body.change_updates || []),
        root_cause: body.root_cause,
        workaround: body.workaround,
        created_at: ts,
        updated_at: ts,
      });
      const ticketNo = `${TYPE_PREFIX[body.type]}-${year}${month}-${String(ticketId).padStart(4, '0')}`;
      await trx('tickets').where({ id: ticketId }).update({ ticket_no: ticketNo });
      await insertReturningId(trx('ticket_stage_history'), {
        ticket_id: ticketId,
        stage_id: firstStage.id,
        stage_name: firstStage.name,
        action: 'created',
        actor_id: request.auth.id,
        comment: '创建工单',
        created_at: ts,
      });
      for (const ciId of uniqueCiIds) {
        await insertReturningId(trx('ticket_cis'), { ticket_id: ticketId, ci_id: ciId, created_at: ts });
      }
      return ticketId;
    });
    await audit(request, {
      action: 'ticket.create',
      entityType: 'ticket',
      entityId: id,
      summary: `创建${body.type === 'incident' ? '事件' : body.type === 'problem' ? '问题' : '变更'}：${body.title}`,
    });
    queueTicketNotification('ticket.created', id, { actorName: request.auth.name });
    return reply.code(201).send({ data: await ticketDetail(id) });
  });

  app.put('/api/tickets/:id', { preHandler: [authenticate, requirePermission('itsm.edit')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const ticket = await db('tickets').where({ id }).first();
    if (!ticket) return reply.code(404).send({ message: '工单不存在' });
    const schema = z.object({
      title: z.string().trim().min(3).optional(),
      description: z.string().optional(),
      priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
      impact: z.enum(['high', 'medium', 'low']).optional(),
      urgency: z.enum(['critical', 'high', 'medium', 'low']).optional(),
      category: z.string().optional(),
      assignee_id: z.coerce.number().int().positive().nullable().optional(),
      resolution: z.string().optional(),
      root_cause: z.string().optional(),
      workaround: z.string().optional(),
      risk: z.enum(['high', 'medium', 'low']).optional(),
      change_type: z.enum(['standard', 'normal', 'emergency']).optional(),
      planned_start: z.string().optional(),
      planned_end: z.string().optional(),
      implementation_plan: z.string().optional(),
      rollback_plan: z.string().optional(),
      test_plan: z.string().optional(),
      cab_date: z.string().optional(),
      outage_required: z.boolean().optional(),
    });
    const body = schema.parse(request.body || {});
    if (body.description !== undefined) body.description = sanitizeRichText(body.description);
    await db('tickets').where({ id }).update({ ...body, updated_at: nowIso() });
    if (body.assignee_id !== undefined) {
      const newAssignee = body.assignee_id ? await db('users').where({ id: body.assignee_id }).first() : null;
      await insertReturningId(db('ticket_stage_history'), {
        ticket_id: id,
        stage_id: ticket.current_stage_id,
        stage_name: '',
        action: 'assigned',
        actor_id: request.auth.id,
        comment: newAssignee ? `负责人变更为 ${newAssignee.name}` : '取消负责人',
        created_at: nowIso(),
      });
    }
    await audit(request, { action: 'ticket.update', entityType: 'ticket', entityId: id, summary: `更新工单 ${ticket.ticket_no}` });
    if (body.assignee_id !== undefined && body.assignee_id !== ticket.assignee_id) {
      queueTicketNotification('ticket.assigned', id, { actorName: request.auth.name });
    }
    return { data: await ticketDetail(id) };
  });

  app.post('/api/tickets/:id/advance', { preHandler: [authenticate, requirePermission('itsm.edit', 'itsm.approve')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const schema = z.object({
      action: z.enum(['advance', 'approve', 'reject', 'complete']),
      comment: z.string().default(''),
    });
    const body = schema.parse(request.body || {});
    const ticket = await db('tickets').where({ id }).first();
    if (!ticket) return reply.code(404).send({ message: '工单不存在' });
    if (CLOSED_STATUSES.has(ticket.status)) return reply.code(400).send({ message: '工单已关闭或取消，无法继续流转' });
    const stage = await db('workflow_stages').where({ id: ticket.current_stage_id }).first();
    if (!stage) return reply.code(400).send({ message: '当前流程阶段不存在，请联系管理员' });
    if (stage.stage_type === 'approval' && !['approve', 'reject'].includes(body.action)) {
      return reply.code(400).send({ message: '审批阶段需要选择「通过」或「驳回」' });
    }
    if (stage.stage_type !== 'approval' && ['approve', 'reject'].includes(body.action)) {
      return reply.code(400).send({ message: '当前阶段不是审批阶段' });
    }
    if (body.action === 'reject' && !body.comment.trim()) {
      return reply.code(400).send({ message: '驳回时必须填写审批意见' });
    }
    if (stage.stage_type === 'approval' && !hasPermission(request.auth, 'itsm.approve')) {
      return reply.code(403).send({ message: '当前角色没有审批权限' });
    }
    if (stage.stage_type !== 'approval' && !hasPermission(request.auth, 'itsm.edit')) {
      return reply.code(403).send({ message: '当前角色没有处理工单权限' });
    }
    if (body.action === 'complete' && stage.stage_type !== 'end') {
      return reply.code(400).send({ message: '仅可在结束阶段完成并关闭工单' });
    }
    if (stage.approver_role_id && request.auth.role?.code !== 'admin' && request.auth.role?.id !== stage.approver_role_id) {
      return reply.code(403).send({ message: '该阶段仅限指定审批角色处理' });
    }

    const ts = nowIso();
    if (body.action === 'reject') {
      await db.transaction(async (trx) => {
        await trx('tickets').where({ id }).update({ status: 'cancelled', updated_at: ts });
        await insertReturningId(trx('ticket_stage_history'), {
          ticket_id: id,
          stage_id: stage.id,
          stage_name: stage.name,
          action: 'rejected',
          actor_id: request.auth.id,
          comment: body.comment,
          created_at: ts,
        });
        await insertReturningId(trx('ticket_comments'), {
          ticket_id: id,
          user_id: request.auth.id,
          body: `【审批驳回】${body.comment}`,
          is_internal: true,
          created_at: ts,
        });
      });
      await audit(request, { action: 'ticket.reject', entityType: 'ticket', entityId: id, summary: `驳回工单 ${ticket.ticket_no}` });
      queueTicketNotification('ticket.rejected', id, { actorName: request.auth.name });
      return { data: await ticketDetail(id) };
    }

    if (body.action === 'complete') {
      await db.transaction(async (trx) => {
        await trx('tickets').where({ id }).update({
          status: 'closed',
          closed_at: ts,
          resolved_at: ticket.resolved_at || ts,
          updated_at: ts,
        });
        await insertReturningId(trx('ticket_stage_history'), {
          ticket_id: id,
          stage_id: stage.id,
          stage_name: stage.name,
          action: 'closed',
          actor_id: request.auth.id,
          comment: body.comment || '完成处理并关闭',
          created_at: ts,
        });
      });
      await audit(request, { action: 'ticket.close', entityType: 'ticket', entityId: id, summary: `关闭工单 ${ticket.ticket_no}` });
      queueTicketNotification('ticket.closed', id, { actorName: request.auth.name });
      return { data: await ticketDetail(id) };
    }

    const stages = await db('workflow_stages').where({ workflow_id: ticket.workflow_id }).orderBy('seq');
    const index = stages.findIndex((item) => item.id === stage.id);
    const next = stages[index + 1];
    await db.transaction(async (trx) => {
      if (!next) {
        await trx('tickets').where({ id }).update({
          status: 'resolved',
          resolved_at: ticket.resolved_at || ts,
          updated_at: ts,
        });
        await insertReturningId(trx('ticket_stage_history'), {
          ticket_id: id,
          stage_id: stage.id,
          stage_name: stage.name,
          action: body.action === 'approve' ? 'approved' : 'resolved',
          actor_id: request.auth.id,
          comment: body.comment || '流程已完成',
          created_at: ts,
        });
        return;
      }
      let nextStatus = 'in_progress';
      let resolvedAt = ticket.resolved_at;
      if (next.stage_type === 'approval') nextStatus = 'pending_approval';
      if (next.stage_type === 'end') {
        if (ticket.type === 'change') {
          nextStatus = 'in_progress';
        } else {
          nextStatus = 'resolved';
          resolvedAt = resolvedAt || ts;
        }
      }
      await trx('tickets').where({ id }).update({
        status: nextStatus,
        current_stage_id: next.id,
        sla_due_at: addHours(ts, next.sla_hours),
        resolved_at: resolvedAt,
        updated_at: ts,
      });
      await insertReturningId(trx('ticket_stage_history'), {
        ticket_id: id,
        stage_id: stage.id,
        stage_name: stage.name,
        action: body.action === 'approve' ? 'approved' : 'advanced',
        actor_id: request.auth.id,
        comment: body.comment || `进入「${next.name}」`,
        created_at: ts,
      });
    });
    await audit(request, {
      action: body.action === 'approve' ? 'ticket.approve' : 'ticket.advance',
      entityType: 'ticket',
      entityId: id,
      summary: `${body.action === 'approve' ? '审批通过' : '流转'}工单 ${ticket.ticket_no}`,
    });
    if (body.action === 'complete') await resolveLinkedZabbixEvents(id);
    if (body.action === 'complete' && ticket.type === 'change') {
      const updates = parseJson(ticket.change_updates, []);
      const linked = await db('ticket_cis').where({ ticket_id: id });
      const linkedIds = new Set(linked.map((item) => Number(item.ci_id)));
      const basicFields = new Set(['name', 'status', 'criticality', 'environment', 'department', 'location', 'vendor', 'model', 'serial_no', 'os_name', 'cpu', 'memory', 'disk', 'bmc_address', 'mac_address', 'purchase_date', 'warranty_end', 'cost', 'description']);
      for (const item of Array.isArray(updates) ? updates : []) {
        const ciId = Number(item.ci_id);
        if (!linkedIds.has(ciId) || !item.field_key) continue;
        const ci = await db('cis').where({ id: ciId }).first();
        if (!ci) continue;
        const field = String(item.field_key);
        const value = item.value ?? '';
        if (basicFields.has(field)) {
          await db('cis').where({ id: ciId }).update({ [field]: value, updated_at: ts });
        } else {
          const key = field.startsWith('attributes.') ? field.slice('attributes.'.length) : field.replace(/^attr:/, '');
          if (!/^[a-zA-Z0-9_]+$/.test(key)) continue;
          const attributes = { ...parseJson(ci.attributes, {}), [key]: value };
          await db('cis').where({ id: ciId }).update({ attributes: JSON.stringify(attributes), updated_at: ts });
        }
        await insertReturningId(db('ci_change_logs'), {
          ci_id: ciId,
          ticket_id: id,
          action: 'change_update',
          changes: JSON.stringify({ [field]: { to: value } }),
          actor_id: request.auth.id,
          created_at: ts,
        });
      }
    }
    if (ticket.type === 'change' && ['complete', 'close'].includes(body.action)) {
      const linked = await db('ticket_cis').where({ ticket_id: id });
      for (const item of linked) {
        await insertReturningId(db('ci_change_logs'), {
          ci_id: item.ci_id,
          action: 'workflow',
          changes: JSON.stringify({ workflow: { from: '执行中', to: '变更完成' } }),
          source: 'change_ticket',
          ticket_id: id,
          actor_id: request.auth.id,
          created_at: nowIso(),
        });
      }
    }
    queueTicketNotification(body.action === 'approve' ? 'ticket.approved' : 'ticket.advanced', id, { actorName: request.auth.name });
    return { data: await ticketDetail(id) };
  });

  app.post('/api/tickets/:id/close', { preHandler: [authenticate, requirePermission('itsm.edit')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const schema = z.object({
      resolution: z.string().optional(),
      comment: z.string().default(''),
    });
    const body = schema.parse(request.body || {});
    const ticket = await db('tickets').where({ id }).first();
    if (!ticket) return reply.code(404).send({ message: '工单不存在' });
    if (CLOSED_STATUSES.has(ticket.status)) return reply.code(400).send({ message: '工单已关闭' });
    const ts = nowIso();
    const stage = await db('workflow_stages').where({ id: ticket.current_stage_id }).first();
    await db.transaction(async (trx) => {
      await trx('tickets').where({ id }).update({
        status: 'closed',
        resolution: body.resolution !== undefined ? body.resolution : ticket.resolution,
        resolved_at: ticket.resolved_at || ts,
        closed_at: ts,
        updated_at: ts,
      });
      await insertReturningId(trx('ticket_stage_history'), {
        ticket_id: id,
        stage_id: stage?.id || null,
        stage_name: stage?.name || '',
        action: 'closed',
        actor_id: request.auth.id,
        comment: body.comment || '关闭工单',
        created_at: ts,
      });
    });
    await audit(request, { action: 'ticket.close', entityType: 'ticket', entityId: id, summary: `关闭工单 ${ticket.ticket_no}` });
    await resolveLinkedZabbixEvents(id);
    queueTicketNotification('ticket.closed', id, { actorName: request.auth.name });
    return { data: await ticketDetail(id) };
  });

  app.post('/api/tickets/:id/reopen', { preHandler: [authenticate, requirePermission('itsm.edit')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const ticket = await db('tickets').where({ id }).first();
    if (!ticket) return reply.code(404).send({ message: '工单不存在' });
    if (!CLOSED_STATUSES.has(ticket.status) && ticket.status !== 'resolved') {
      return reply.code(400).send({ message: '仅已解决或已关闭的工单可以重新打开' });
    }
    const ts = nowIso();
    await db('tickets').where({ id }).update({
      status: 'in_progress',
      closed_at: null,
      resolved_at: null,
      updated_at: ts,
    });
    await insertReturningId(db('ticket_stage_history'), {
      ticket_id: id,
      stage_id: ticket.current_stage_id,
      stage_name: '',
      action: 'reopened',
      actor_id: request.auth.id,
      comment: request.body?.comment || '重新打开工单',
      created_at: ts,
    });
    await audit(request, { action: 'ticket.reopen', entityType: 'ticket', entityId: id, summary: `重新打开工单 ${ticket.ticket_no}` });
    queueTicketNotification('ticket.reopened', id, { actorName: request.auth.name });
    return { data: await ticketDetail(id) };
  });

  app.post('/api/tickets/:id/comments', { preHandler: [authenticate, requirePermission('itsm.view')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const schema = z.object({
      body: z.string().trim().min(1, '评论不能为空'),
      is_internal: z.boolean().default(false),
    });
    const body = schema.parse(request.body || {});
    const ticket = await db('tickets').where({ id }).first();
    if (!ticket) return reply.code(404).send({ message: '工单不存在' });
    if (!(await canViewTicket(ticket, request.auth))) return reply.code(403).send({ message: '无权评论该工单' });
    if (body.is_internal && !hasPermission(request.auth, 'itsm.edit')) {
      return reply.code(403).send({ message: '没有添加内部备注的权限' });
    }
    await insertReturningId(db('ticket_comments'), {
      ticket_id: id,
      user_id: request.auth.id,
      body: sanitizeRichText(body.body),
      is_internal: body.is_internal,
      created_at: nowIso(),
    });
    await audit(request, { action: 'ticket.comment', entityType: 'ticket', entityId: id, summary: `评论工单 ${ticket.ticket_no}` });
    const data = await ticketDetail(id);
    if (request.auth.role?.code === 'employee') data.comments = data.comments.filter((comment) => !comment.is_internal);
    return reply.code(201).send({ data });
  });

  app.post('/api/tickets/:id/cis', { preHandler: [authenticate, requirePermission('itsm.edit')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const ciId = Number(request.body?.ci_id);
    if (!ciId) return reply.code(400).send({ message: '请选择 CI' });
    const [ticket, ci] = await Promise.all([db('tickets').where({ id }).first(), db('cis').where({ id: ciId }).first()]);
    if (!ticket) return reply.code(404).send({ message: '工单不存在' });
    if (!ci) return reply.code(404).send({ message: 'CI 不存在' });
    if (!(await canAccessCI(request.auth, ci))) return reply.code(403).send({ message: '无权关联该资产' });
    if (await db('ticket_cis').where({ ticket_id: id, ci_id: ciId }).first()) {
      return reply.code(409).send({ message: '该 CI 已关联' });
    }
    await insertReturningId(db('ticket_cis'), { ticket_id: id, ci_id: ciId, created_at: nowIso() });
    await audit(request, { action: 'ticket.ci_link', entityType: 'ticket', entityId: id, summary: `工单 ${ticket.ticket_no} 关联 CI ${ci.asset_no}` });
    return { data: await ticketDetail(id) };
  });

  app.delete('/api/tickets/:id/cis/:ciId', { preHandler: [authenticate, requirePermission('itsm.edit')] }, async (request) => {
    const id = Number(request.params.id);
    const ciId = Number(request.params.ciId);
    await db('ticket_cis').where({ ticket_id: id, ci_id: ciId }).del();
    return { ok: true };
  });

  app.post('/api/tickets/:id/relations', { preHandler: [authenticate, requirePermission('itsm.edit')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const schema = z.object({
      linked_ticket_id: z.coerce.number().int().positive(),
      relation_type: z.enum(['related', 'caused_by', 'duplicate', 'blocks']).default('related'),
    });
    const body = schema.parse(request.body || {});
    if (body.linked_ticket_id === id) return reply.code(400).send({ message: '不能关联自身' });
    const [ticket, linked] = await Promise.all([
      db('tickets').where({ id }).first(),
      db('tickets').where({ id: body.linked_ticket_id }).first(),
    ]);
    if (!ticket || !linked) return reply.code(404).send({ message: '工单不存在' });
    if (await db('ticket_relations').where({ ticket_id: id, linked_ticket_id: body.linked_ticket_id, relation_type: body.relation_type }).first()) {
      return reply.code(409).send({ message: '关联已存在' });
    }
    await insertReturningId(db('ticket_relations'), {
      ticket_id: id,
      linked_ticket_id: body.linked_ticket_id,
      relation_type: body.relation_type,
      created_at: nowIso(),
    });
    return { data: await ticketDetail(id) };
  });

  app.delete('/api/tickets/:id/relations/:relationId', { preHandler: [authenticate, requirePermission('itsm.edit')] }, async (request) => {
    await db('ticket_relations').where({ id: Number(request.params.relationId), ticket_id: Number(request.params.id) }).del();
    return { ok: true };
  });

  app.delete('/api/tickets/:id', { preHandler: [authenticate] }, async (request, reply) => {
    if (request.auth.role?.code !== 'admin') {
      return reply.code(403).send({ message: '仅系统管理员可以删除工单' });
    }
    const id = Number(request.params.id);
    const ticket = await db('tickets').where({ id }).first();
    if (!ticket) return reply.code(404).send({ message: '工单不存在' });
    const ts = nowIso();
    await db.transaction(async (trx) => {
      await trx('ticket_deletion_requests')
        .where({ ticket_id: id, status: 'pending' })
        .update({
          status: 'approved',
          reviewed_by: request.auth.id,
          review_comment: '超级管理员直接删除',
          reviewed_at: ts,
        });
      await trx('tickets').where({ id }).del();
    });
    await audit(request, { action: 'ticket.delete', entityType: 'ticket', entityId: id, summary: `超级管理员删除工单 ${ticket.ticket_no}` });
    return { ok: true };
  });

  app.post('/api/tickets/:id/attachments', { preHandler: [authenticate, requirePermission('itsm.view')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const ticket = await db('tickets').where({ id }).first();
    if (!ticket) return reply.code(404).send({ message: '工单不存在' });
    const file = await request.file();
    if (!file) return reply.code(400).send({ message: '请选择文件' });
    const buffer = await file.toBuffer();
    if (buffer.length > 50 * 1024 * 1024) return reply.code(413).send({ message: '附件不能超过 50MB' });
    ensureUploadDir();
    const ext = path.extname(file.filename || '').slice(0, 20);
    const storedName = `${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buffer);
    const attachmentId = await insertReturningId(db('ticket_attachments'), {
      ticket_id: id,
      comment_id: null,
      filename: String(file.filename || 'attachment').slice(0, 300),
      stored_name: storedName,
      mime_type: file.mimetype || 'application/octet-stream',
      size: buffer.length,
      uploaded_by: request.auth.id,
      created_at: nowIso(),
    });
    await audit(request, { action: 'ticket.attachment', entityType: 'ticket', entityId: id, summary: `上传附件 ${file.filename}` });
    return reply.code(201).send({ data: await db('ticket_attachments').where({ id: attachmentId }).first() });
  });

  app.get('/api/ticket-attachments/:id', { preHandler: [authenticate, requirePermission('itsm.view')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const attachment = await db('ticket_attachments').where({ id }).first();
    if (!attachment) return reply.code(404).send({ message: '附件不存在' });
    const filePath = path.join(UPLOAD_DIR, attachment.stored_name);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ message: '附件文件不存在' });
    const safeName = encodeURIComponent(attachment.filename);
    reply.header('Content-Disposition', `inline; filename*=UTF-8''${safeName}`);
    reply.type(attachment.mime_type || 'application/octet-stream');
    return reply.send(fs.createReadStream(filePath));
  });

  app.get('/api/tickets/:id/activity', { preHandler: [authenticate, requirePermission('itsm.view')] }, async (request, reply) => {
    const ticket = await db('tickets').where({ id: Number(request.params.id) }).first();
    if (!ticket) return reply.code(404).send({ message: '工单不存在' });
    const history = await db('ticket_stage_history')
      .leftJoin('users', 'ticket_stage_history.actor_id', 'users.id')
      .select('ticket_stage_history.*', 'users.name as actor_name')
      .where({ ticket_id: ticket.id })
      .orderBy('created_at');
    return { data: history };
  });
}

export { ticketDetail };
