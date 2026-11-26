import { z } from 'zod';
import { db, insertReturningId } from '../db/index.js';
import { authenticate, requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { nowIso } from '../lib/helpers.js';
import { ensureRelationTypes } from '../lib/relationTypes.js';

const relationSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[a-z][a-z0-9_]+$/, '关系标识需为小写字母、数字与下划线'),
  name: z.string().trim().min(1).max(120),
  reverse_name: z.string().trim().min(1).max(120),
  from_type_id: z.coerce.number().int().positive().nullable().optional(),
  to_type_id: z.coerce.number().int().positive().nullable().optional(),
  color: z.string().default('#4f6ef7'),
  description: z.string().default(''),
  enabled: z.preprocess((value) => value === 1 || value === '1' || value === true, z.boolean()).default(true),
  sort_order: z.coerce.number().default(99),
});

async function relationTypeList() {
  await ensureRelationTypes(db);
  const rows = await db('ci_relation_types')
    .leftJoin('ci_types as from_type', 'ci_relation_types.from_type_id', 'from_type.id')
    .leftJoin('ci_types as to_type', 'ci_relation_types.to_type_id', 'to_type.id')
    .select(
      'ci_relation_types.*',
      'from_type.name as from_type_name',
      'from_type.code as from_type_code',
      'to_type.name as to_type_name',
      'to_type.code as to_type_code',
    )
    .orderBy('ci_relation_types.sort_order')
    .orderBy('ci_relation_types.id');
  const usage = await db('ci_relations').select('relation_type').count({ count: '*' }).groupBy('relation_type');
  const usageMap = Object.fromEntries(usage.map((row) => [row.relation_type, Number(row.count)]));
  return rows.map((row) => ({ ...row, usage_count: usageMap[row.code] || 0 }));
}

export default async function relationRoutes(app) {
  app.get('/api/ci-relation-types', { preHandler: authenticate }, async (request) => {
    const all = await relationTypeList();
    const data = request.query.enabled === 'true' ? all.filter((item) => item.enabled) : all;
    return { data };
  });

  app.post('/api/ci-relation-types', { preHandler: [authenticate, requirePermission('cmdb.model_manage')] }, async (request, reply) => {
    const body = relationSchema.parse(request.body || {});
    if (await db('ci_relation_types').where({ code: body.code }).first()) {
      return reply.code(409).send({ message: '关系标识已存在' });
    }
    const ts = nowIso();
    const id = await insertReturningId(db('ci_relation_types'), {
      ...body,
      from_type_id: body.from_type_id || null,
      to_type_id: body.to_type_id || null,
      builtin: false,
      created_at: ts,
      updated_at: ts,
    });
    await audit(request, { action: 'relation_type.create', entityType: 'relation_type', entityId: id, summary: `新增关联关系「${body.name} / ${body.reverse_name}」` });
    return reply.code(201).send({ data: (await relationTypeList()).find((item) => item.id === id) });
  });

  app.put('/api/ci-relation-types/:id', { preHandler: [authenticate, requirePermission('cmdb.model_manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const existing = await db('ci_relation_types').where({ id }).first();
    if (!existing) return reply.code(404).send({ message: '关联关系不存在' });
    const schema = relationSchema.partial().omit({ code: true });
    const body = schema.parse(request.body || {});
    await db('ci_relation_types')
      .where({ id })
      .update({
        ...body,
        ...(body.from_type_id !== undefined ? { from_type_id: body.from_type_id || null } : {}),
        ...(body.to_type_id !== undefined ? { to_type_id: body.to_type_id || null } : {}),
        updated_at: nowIso(),
      });
    await audit(request, { action: 'relation_type.update', entityType: 'relation_type', entityId: id, summary: `更新关联关系「${body.name || existing.name}」` });
    return { data: (await relationTypeList()).find((item) => item.id === id) };
  });

  app.delete('/api/ci-relation-types/:id', { preHandler: [authenticate, requirePermission('cmdb.model_manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const existing = await db('ci_relation_types').where({ id }).first();
    if (!existing) return reply.code(404).send({ message: '关联关系不存在' });
    if (existing.builtin) return reply.code(400).send({ message: '内置关系不可删除，可停用或修改显示名称' });
    const count = await db('ci_relations').where({ relation_type: existing.code }).count({ count: '*' }).first();
    if (Number(count?.count || 0) > 0) return reply.code(409).send({ message: '该关系已被 CI 使用，无法删除；可停用后保留历史关系' });
    await db('ci_relation_types').where({ id }).del();
    await audit(request, { action: 'relation_type.delete', entityType: 'relation_type', entityId: id, summary: `删除关联关系「${existing.name}」` });
    return { ok: true };
  });
}
