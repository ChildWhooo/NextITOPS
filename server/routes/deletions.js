import { z } from 'zod';
import { db, insertReturningId } from '../db/index.js';
import { authenticate, requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { nowIso } from '../lib/helpers.js';
import { getDeletionPolicy, canApproveDeletion } from '../lib/deletionPolicy.js';

async function requestWithUsers(id) {
  return db('ticket_deletion_requests')
    .leftJoin('users as requester', 'ticket_deletion_requests.requested_by', 'requester.id')
    .leftJoin('users as reviewer', 'ticket_deletion_requests.reviewed_by', 'reviewer.id')
    .select(
      'ticket_deletion_requests.*',
      'requester.name as requester_name',
      'requester.department as requester_department',
      'reviewer.name as reviewer_name',
    )
    .where('ticket_deletion_requests.id', id)
    .first();
}

export default async function deletionRoutes(app) {
  app.get('/api/deletion-policy', { preHandler: authenticate }, async (request) => {
    const policy = await getDeletionPolicy();
    return { data: { ...policy, can_approve: await canApproveDeletion(request.auth) } };
  });

  app.put('/api/deletion-policy', { preHandler: authenticate }, async (request, reply) => {
    if (request.auth.role?.code !== 'admin') return reply.code(403).send({ message: '仅超级管理员可以配置删除审批流程' });
    const schema = z.object({ approver_role_ids: z.array(z.coerce.number().int().positive()).max(20) });
    const body = schema.parse(request.body || {});
    const uniqueIds = [...new Set(body.approver_role_ids)];
    if (uniqueIds.length) {
      const roles = await db('roles').whereIn('id', uniqueIds);
      if (roles.length !== uniqueIds.length) return reply.code(400).send({ message: '审批角色不存在' });
    }
    const policy = await getDeletionPolicy();
    await db('deletion_policies').where({ id: policy.id }).update({
      approver_role_ids: JSON.stringify(uniqueIds),
      updated_by: request.auth.id,
      updated_at: nowIso(),
    });
    await audit(request, { action: 'deletion.policy_update', entityType: 'system', summary: `更新删除审批流程：${uniqueIds.length ? `${uniqueIds.length} 个审批角色` : '仅超级管理员'}` });
    return { data: await getDeletionPolicy() };
  });

  app.post('/api/tickets/:id/deletion-request', { preHandler: [authenticate, requirePermission('itsm.view')] }, async (request, reply) => {
    const ticketId = Number(request.params.id);
    const ticket = await db('tickets').where({ id: ticketId }).first();
    if (!ticket) return reply.code(404).send({ message: '工单不存在' });
    if (request.auth.role?.code === 'employee' && ticket.requester_id !== request.auth.id && ticket.assignee_id !== request.auth.id) {
      return reply.code(403).send({ message: '无权对该工单发起删除申请' });
    }
    const schema = z.object({ reason: z.string().trim().min(4, '请填写至少 4 个字的删除原因') });
    const { reason } = schema.parse(request.body || {});
    const pending = await db('ticket_deletion_requests').where({ ticket_id: ticketId, status: 'pending' }).first();
    if (pending) return reply.code(409).send({ message: '该工单已有待审批的删除申请' });
    const id = await insertReturningId(db('ticket_deletion_requests'), {
      ticket_id: ticketId,
      ticket_no: ticket.ticket_no,
      ticket_type: ticket.type,
      ticket_title: ticket.title,
      requested_by: request.auth.id,
      reason,
      status: 'pending',
      reviewed_by: null,
      review_comment: '',
      created_at: nowIso(),
      reviewed_at: null,
    });
    await audit(request, {
      action: 'ticket.deletion_request',
      entityType: 'ticket',
      entityId: ticketId,
      summary: `申请删除工单 ${ticket.ticket_no}：${reason.slice(0, 80)}`,
    });
    return reply.code(201).send({ data: await requestWithUsers(id) });
  });

  app.get('/api/deletion-requests', { preHandler: authenticate }, async (request, reply) => {
    if (!(await canApproveDeletion(request.auth))) return reply.code(403).send({ message: '当前角色不在删除审批流程中' });
    const page = Math.max(1, Number(request.query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(request.query.pageSize || 15)));
    const query = db('ticket_deletion_requests')
      .leftJoin('users as requester', 'ticket_deletion_requests.requested_by', 'requester.id')
      .leftJoin('users as reviewer', 'ticket_deletion_requests.reviewed_by', 'reviewer.id');
    if (request.query.status) query.where('ticket_deletion_requests.status', request.query.status);
    if (request.query.q) {
      const term = `%${request.query.q}%`;
      query.where((builder) =>
        builder
          .where('ticket_deletion_requests.ticket_no', 'like', term)
          .orWhere('ticket_deletion_requests.ticket_title', 'like', term)
          .orWhere('requester.name', 'like', term),
      );
    }
    const totalRow = await query.clone().count({ count: 'ticket_deletion_requests.id' }).first();
    const rows = await query
      .select(
        'ticket_deletion_requests.*',
        'requester.name as requester_name',
        'requester.department as requester_department',
        'reviewer.name as reviewer_name',
      )
      .orderByRaw("case ticket_deletion_requests.status when 'pending' then 0 else 1 end")
      .orderBy('ticket_deletion_requests.created_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const counts = await db('ticket_deletion_requests').select('status').count({ count: '*' }).groupBy('status');
    return {
      data: rows,
      counts: Object.fromEntries(counts.map((row) => [row.status, Number(row.count)])),
      pagination: { page, pageSize, total: Number(totalRow?.count || 0) },
    };
  });

  app.post('/api/deletion-requests/:id/approve', { preHandler: authenticate }, async (request, reply) => {
    if (!(await canApproveDeletion(request.auth))) return reply.code(403).send({ message: '当前角色不在删除审批流程中' });
    const id = Number(request.params.id);
    const deletion = await db('ticket_deletion_requests').where({ id }).first();
    if (!deletion) return reply.code(404).send({ message: '删除申请不存在' });
    if (deletion.status !== 'pending') return reply.code(400).send({ message: '该申请已处理' });
    if (deletion.requested_by === request.auth.id && request.auth.role?.code !== 'admin') {
      return reply.code(403).send({ message: '不能审批自己发起的删除申请' });
    }
    const ticket = deletion.ticket_id ? await db('tickets').where({ id: deletion.ticket_id }).first() : null;
    if (!ticket) {
      await db('ticket_deletion_requests').where({ id }).update({ status: 'rejected', reviewed_by: request.auth.id, review_comment: '工单已不存在，申请自动关闭', reviewed_at: nowIso(), ticket_id: null });
      return reply.code(404).send({ message: '工单已不存在，申请已自动关闭' });
    }
    const ts = nowIso();
    const comment = String(request.body?.comment || '').slice(0, 1000);
    await db.transaction(async (trx) => {
      await trx('ticket_deletion_requests').where({ id }).update({
        status: 'approved',
        reviewed_by: request.auth.id,
        review_comment: comment,
        reviewed_at: ts,
      });
      await trx('tickets').where({ id: ticket.id }).del();
      await trx('ticket_deletion_requests').where({ id }).update({ ticket_id: null });
    });
    await audit(request, {
      action: 'ticket.deletion_approve',
      entityType: 'ticket',
      entityId: ticket.id,
      summary: `审批通过删除工单 ${deletion.ticket_no}`,
      detail: { request_id: id, ticket_no: deletion.ticket_no, reason: deletion.reason, comment },
    });
    return { ok: true, deleted_ticket: deletion.ticket_no };
  });

  app.post('/api/deletion-requests/:id/reject', { preHandler: authenticate }, async (request, reply) => {
    if (!(await canApproveDeletion(request.auth))) return reply.code(403).send({ message: '当前角色不在删除审批流程中' });
    const id = Number(request.params.id);
    const deletion = await db('ticket_deletion_requests').where({ id }).first();
    if (!deletion) return reply.code(404).send({ message: '删除申请不存在' });
    if (deletion.status !== 'pending') return reply.code(400).send({ message: '该申请已处理' });
    const comment = String(request.body?.comment || '').trim();
    if (!comment) return reply.code(400).send({ message: '驳回时必须填写审批意见' });
    await db('ticket_deletion_requests').where({ id }).update({
      status: 'rejected',
      reviewed_by: request.auth.id,
      review_comment: comment.slice(0, 1000),
      reviewed_at: nowIso(),
    });
    await audit(request, {
      action: 'ticket.deletion_reject',
      entityType: 'ticket',
      entityId: deletion.ticket_id,
      summary: `驳回删除工单 ${deletion.ticket_no}`,
      detail: { request_id: id, comment },
    });
    return { ok: true };
  });
}
