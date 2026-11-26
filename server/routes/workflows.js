import { z } from 'zod';
import { db, insertReturningId } from '../db/index.js';
import { authenticate, requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { httpError, nowIso } from '../lib/helpers.js';

const stageSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  stage_key: z.string().trim().min(2).regex(/^[a-z][a-z0-9_]+$/, '阶段标识需为小写字母、数字与下划线'),
  name: z.string().trim().min(1),
  stage_type: z.enum(['start', 'task', 'approval', 'end']),
  color: z.string().default('#4f6ef7'),
  description: z.string().default(''),
  sla_hours: z.coerce.number().min(0).default(24),
  assignee_role_id: z.coerce.number().int().positive().nullable().optional(),
  approver_role_id: z.coerce.number().int().positive().nullable().optional(),
});

function validateStages(stages) {
  if (!Array.isArray(stages) || stages.length < 2) throw httpError(400, '流程至少需要两个阶段');
  if (stages[0].stage_type !== 'start') throw httpError(400, '第一个阶段必须为「开始」类型');
  if (stages[stages.length - 1].stage_type !== 'end') throw httpError(400, '最后一个阶段必须为「结束」类型');
  const keys = new Set();
  for (const stage of stages) {
    if (keys.has(stage.stage_key)) throw httpError(400, `阶段标识重复：${stage.stage_key}`);
    keys.add(stage.stage_key);
  }
}

async function stageRows(workflowId) {
  return db('workflow_stages')
    .leftJoin('roles as assignee_role', 'workflow_stages.assignee_role_id', 'assignee_role.id')
    .leftJoin('roles as approver_role', 'workflow_stages.approver_role_id', 'approver_role.id')
    .select(
      'workflow_stages.*',
      'assignee_role.name as assignee_role_name',
      'approver_role.name as approver_role_name',
    )
    .where('workflow_stages.workflow_id', workflowId)
    .orderBy('workflow_stages.seq');
}

async function workflowDetail(id) {
  const workflow = await db('workflows').where({ id }).first();
  if (!workflow) return null;
  const stages = await stageRows(id);
  const ticketCount = await db('tickets').where({ workflow_id: id }).count({ count: '*' }).first();
  const byStatus = await db('tickets').where({ workflow_id: id }).select('status').count({ count: '*' }).groupBy('status');
  return {
    ...workflow,
    stages,
    ticket_count: Number(ticketCount?.count || 0),
    ticket_status: Object.fromEntries(byStatus.map((row) => [row.status, Number(row.count)])),
  };
}

async function clearDefault(trx, type, exceptId = null) {
  const query = trx('workflows').where({ ticket_type: type }).update({ is_default: false });
  if (exceptId) query.whereNot({ id: exceptId });
  await query;
}

export default async function workflowRoutes(app) {
  app.get('/api/workflows', { preHandler: [authenticate, requirePermission('itsm.view')] }, async (request) => {
    const query = db('workflows').orderBy('ticket_type').orderByRaw('is_default desc').orderBy('id');
    if (request.query.type) query.where({ ticket_type: request.query.type });
    if (request.query.active !== undefined) query.where({ is_active: request.query.active === 'true' });
    const workflows = await query;
    const counts = await db('tickets').select('workflow_id').count({ count: '*' }).groupBy('workflow_id');
    const countMap = Object.fromEntries(counts.map((row) => [row.workflow_id, Number(row.count)]));
    return {
      data: await Promise.all(
        workflows.map(async (workflow) => ({
          ...workflow,
          stages: await stageRows(workflow.id),
          ticket_count: countMap[workflow.id] || 0,
        })),
      ),
    };
  });

  app.get('/api/workflows/:id', { preHandler: [authenticate, requirePermission('itsm.view')] }, async (request, reply) => {
    const workflow = await workflowDetail(Number(request.params.id));
    if (!workflow) return reply.code(404).send({ message: '流程不存在' });
    return { data: workflow };
  });

  app.post('/api/workflows', { preHandler: [authenticate, requirePermission('itsm.workflow_manage')] }, async (request, reply) => {
    const schema = z.object({
      name: z.string().trim().min(1),
      code: z.string().trim().min(2).regex(/^[A-Z][A-Z0-9_-]+$/, '流程编码需为大写字母、数字、横线'),
      ticket_type: z.enum(['incident', 'problem', 'change']),
      description: z.string().default(''),
      is_default: z.boolean().default(false),
      is_active: z.boolean().default(true),
      stages: z.array(stageSchema).min(2),
    });
    const body = schema.parse(request.body || {});
    validateStages(body.stages);
    if (await db('workflows').where({ code: body.code }).first()) {
      return reply.code(409).send({ message: '流程编码已存在' });
    }
    const ts = nowIso();
    const id = await db.transaction(async (trx) => {
      if (body.is_default) await clearDefault(trx, body.ticket_type);
      const workflowId = await insertReturningId(trx('workflows'), {
        name: body.name,
        code: body.code,
        ticket_type: body.ticket_type,
        description: body.description,
        is_default: body.is_default,
        is_active: body.is_active,
        version: 1,
        created_by: request.auth.id,
        created_at: ts,
        updated_at: ts,
      });
      for (const [index, stage] of body.stages.entries()) {
        await insertReturningId(trx('workflow_stages'), {
          workflow_id: workflowId,
          stage_key: stage.stage_key,
          name: stage.name,
          stage_type: stage.stage_type,
          seq: index + 1,
          color: stage.color,
          description: stage.description,
          sla_hours: stage.sla_hours,
          assignee_role_id: stage.assignee_role_id || null,
          approver_role_id: stage.approver_role_id || null,
          created_at: ts,
        });
      }
      return workflowId;
    });
    await audit(request, { action: 'workflow.create', entityType: 'workflow', entityId: id, summary: `创建流程 ${body.name}` });
    return reply.code(201).send({ data: await workflowDetail(id) });
  });

  app.put('/api/workflows/:id', { preHandler: [authenticate, requirePermission('itsm.workflow_manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const workflow = await db('workflows').where({ id }).first();
    if (!workflow) return reply.code(404).send({ message: '流程不存在' });
    const schema = z.object({
      name: z.string().trim().min(1).optional(),
      description: z.string().optional(),
      is_default: z.boolean().optional(),
      is_active: z.boolean().optional(),
      stages: z.array(stageSchema).min(2).optional(),
    });
    const body = schema.parse(request.body || {});
    const ticketCount = await db('tickets').where({ workflow_id: id }).count({ count: '*' }).first();
    const inUse = Number(ticketCount?.count || 0) > 0;

    if (body.stages) {
      validateStages(body.stages);
      const existing = await db('workflow_stages').where({ workflow_id: id });
      const existingIds = new Set(existing.map((stage) => stage.id));
      const incomingIds = new Set(body.stages.map((stage) => stage.id).filter(Boolean));
      const structuralChange = body.stages.some((stage) => !stage.id) || existing.some((stage) => !incomingIds.has(stage.id));
      if (inUse && structuralChange) {
        return reply.code(409).send({
          message: '该流程已被工单使用，不能增删阶段。请复制流程后调整，或仅修改现有阶段名称、SLA 与处置角色。',
        });
      }
      for (const stage of body.stages) {
        if (stage.id && !existingIds.has(stage.id)) return reply.code(400).send({ message: '阶段不属于当前流程' });
      }
    }

    await db.transaction(async (trx) => {
      if (body.is_default === true) await clearDefault(trx, workflow.ticket_type, id);
      await trx('workflows')
        .where({ id })
        .update({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.is_default !== undefined ? { is_default: body.is_default } : {}),
          ...(body.is_active !== undefined ? { is_active: body.is_active } : {}),
          updated_at: nowIso(),
        });
      if (!body.stages) return;

      if (!inUse) {
        await trx('workflow_stages').where({ workflow_id: id }).del();
        for (const [index, stage] of body.stages.entries()) {
          await insertReturningId(trx('workflow_stages'), {
            workflow_id: id,
            stage_key: stage.stage_key,
            name: stage.name,
            stage_type: stage.stage_type,
            seq: index + 1,
            color: stage.color,
            description: stage.description,
            sla_hours: stage.sla_hours,
            assignee_role_id: stage.assignee_role_id || null,
            approver_role_id: stage.approver_role_id || null,
            created_at: nowIso(),
          });
        }
      } else {
        // Existing tickets point at stages, so keep IDs/order and update descriptive fields only.
        for (const stage of body.stages) {
          if (!stage.id) continue;
          await trx('workflow_stages')
            .where({ id: stage.id, workflow_id: id })
            .update({
              stage_key: stage.stage_key,
              name: stage.name,
              stage_type: stage.stage_type,
              color: stage.color,
              description: stage.description,
              sla_hours: stage.sla_hours,
              assignee_role_id: stage.assignee_role_id || null,
              approver_role_id: stage.approver_role_id || null,
            });
        }
      }
    });
    await audit(request, { action: 'workflow.update', entityType: 'workflow', entityId: id, summary: `更新流程 ${body.name || workflow.name}` });
    return { data: await workflowDetail(id) };
  });

  app.post('/api/workflows/:id/duplicate', { preHandler: [authenticate, requirePermission('itsm.workflow_manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const workflow = await workflowDetail(id);
    if (!workflow) return reply.code(404).send({ message: '流程不存在' });
    let suffix = 1;
    let code = `${workflow.code}_COPY`;
    while (await db('workflows').where({ code }).first()) {
      suffix += 1;
      code = `${workflow.code}_COPY${suffix}`;
    }
    const ts = nowIso();
    const newId = await db.transaction(async (trx) => {
      const workflowId = await insertReturningId(trx('workflows'), {
        name: `${workflow.name} 副本`,
        code,
        ticket_type: workflow.ticket_type,
        description: workflow.description,
        is_default: false,
        is_active: true,
        version: 1,
        created_by: request.auth.id,
        created_at: ts,
        updated_at: ts,
      });
      for (const [index, stage] of workflow.stages.entries()) {
        await insertReturningId(trx('workflow_stages'), {
          workflow_id: workflowId,
          stage_key: stage.stage_key,
          name: stage.name,
          stage_type: stage.stage_type,
          seq: index + 1,
          color: stage.color,
          description: stage.description,
          sla_hours: stage.sla_hours,
          assignee_role_id: stage.assignee_role_id,
          approver_role_id: stage.approver_role_id,
          created_at: ts,
        });
      }
      return workflowId;
    });
    await audit(request, { action: 'workflow.duplicate', entityType: 'workflow', entityId: newId, summary: `复制流程 ${workflow.name}` });
    return reply.code(201).send({ data: await workflowDetail(newId) });
  });

  app.post('/api/workflows/:id/default', { preHandler: [authenticate, requirePermission('itsm.workflow_manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const workflow = await db('workflows').where({ id }).first();
    if (!workflow) return reply.code(404).send({ message: '流程不存在' });
    await db.transaction(async (trx) => {
      await clearDefault(trx, workflow.ticket_type, id);
      await trx('workflows').where({ id }).update({ is_default: true, updated_at: nowIso() });
    });
    await audit(request, { action: 'workflow.default', entityType: 'workflow', entityId: id, summary: `设为默认流程 ${workflow.name}` });
    return { ok: true };
  });

  app.delete('/api/workflows/:id', { preHandler: [authenticate, requirePermission('itsm.workflow_manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const workflow = await db('workflows').where({ id }).first();
    if (!workflow) return reply.code(404).send({ message: '流程不存在' });
    const count = await db('tickets').where({ workflow_id: id }).count({ count: '*' }).first();
    if (Number(count?.count || 0) > 0) return reply.code(409).send({ message: '该流程已有工单使用，不能删除，可停用' });
    if (workflow.is_default) {
      const other = await db('workflows').where({ ticket_type: workflow.ticket_type }).whereNot({ id }).where({ is_active: true }).first();
      if (!other) return reply.code(409).send({ message: '每个工单类型至少保留一个默认流程' });
      await db('workflows').where({ id: other.id }).update({ is_default: true });
    }
    await db('workflows').where({ id }).del();
    await audit(request, { action: 'workflow.delete', entityType: 'workflow', entityId: id, summary: `删除流程 ${workflow.name}` });
    return { ok: true };
  });
}
