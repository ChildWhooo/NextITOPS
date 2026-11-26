import ExcelJS from 'exceljs';
import { asArray, parseJson } from './helpers.js';

export const CORE_COLUMNS = [
  { key: 'asset_no', header: '资产编号', width: 20, required: true },
  { key: 'name', header: '资产名称', width: 30, required: true },
  { key: 'status', header: '状态', width: 12 },
  { key: 'criticality', header: '关键级别', width: 12 },
  { key: 'environment', header: '环境', width: 12 },
  { key: 'owner_name', header: '负责人', width: 14 },
  { key: 'department', header: '所属部门', width: 18 },
  { key: 'location', header: '位置', width: 26 },
  { key: 'vendor', header: '厂商', width: 16 },
  { key: 'model', header: '型号', width: 24 },
  { key: 'serial_no', header: '序列号', width: 18 },
  { key: 'ip_address', header: 'IP 地址', width: 16 },
  { key: 'bmc_address', header: 'BMC 管理地址', width: 18 },
  { key: 'mac_address', header: 'MAC 地址', width: 20 },
  { key: 'os_name', header: '操作系统', width: 24 },
  { key: 'cpu', header: 'CPU', width: 24 },
  { key: 'memory', header: '内存', width: 14 },
  { key: 'disk', header: '磁盘', width: 24 },
  { key: 'purchase_date', header: '采购日期', width: 14 },
  { key: 'warranty_end', header: '保修到期', width: 14 },
  { key: 'cost', header: '资产价值', width: 14 },
  { key: 'description', header: '描述', width: 42 },
];

export const STATUS_LABELS = {
  in_use: '使用中',
  idle: '闲置',
  maintenance: '维护中',
  retired: '已退役',
  planned: '规划中',
};

export const CRITICALITY_LABELS = {
  critical: '核心',
  high: '重要',
  medium: '一般',
  low: '低',
};

export const ENVIRONMENT_LABELS = {
  production: '生产环境',
  staging: '预发布',
  test: '测试环境',
  dr: '灾备环境',
};

const STATUS_REVERSE = Object.fromEntries(Object.entries(STATUS_LABELS).map(([key, label]) => [label, key]));
const CRITICALITY_REVERSE = Object.fromEntries(Object.entries(CRITICALITY_LABELS).map(([key, label]) => [label, key]));
const ENVIRONMENT_REVERSE = Object.fromEntries(Object.entries(ENVIRONMENT_LABELS).map(([key, label]) => [label, key]));

const BRAND = 'FF4F6EF7';
const BRAND_DARK = 'FF1E2A47';
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (value.text !== undefined) return String(value.text).trim();
    if (value.result !== undefined) return String(value.result).trim();
    if (value.richText) return value.richText.map((part) => part.text).join('').trim();
    if (value.hyperlink) return String(value.hyperlink).trim();
    return '';
  }
  return String(value).trim();
}

function dateText(value) {
  const text = cellText(value);
  if (!text) return '';
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

/** Prevent spreadsheet formula injection when user-controlled text is exported. */
function safeExcelValue(value) {
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

export function buildColumns(customFields = [], hiddenKeys = []) {
  const hidden = new Set(hiddenKeys);
  return [
    ...CORE_COLUMNS.filter((column) => !hidden.has(column.key)),
    ...customFields
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((field) => ({
        key: `attr:${field.field_key}`,
        field_key: field.field_key,
        header: field.label,
        width: 20,
        field_type: field.field_type,
        options: asArray(field.options, []),
        required: field.required,
      })),
  ];
}

function decorateSheet(worksheet, columns) {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = { from: 'A1', to: worksheet.getCell(1, columns.length).address };
  worksheet.getRow(1).height = 28;
  columns.forEach((column, index) => {
    const cell = worksheet.getCell(1, index + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Microsoft YaHei' };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    worksheet.getColumn(index + 1).width = column.width || 18;
  });
}

export async function createCITemplate({ ciType, fields, hiddenFields = [] }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NextITOps ITSM';
  workbook.created = new Date();
  const columns = buildColumns(fields, hiddenFields);
  const sheet = workbook.addWorksheet(`${ciType.name}导入`, {
    properties: { tabColor: { argb: BRAND } },
  });
  decorateSheet(sheet, columns);

  for (const [index, column] of columns.entries()) {
    const letter = sheet.getColumn(index + 1).letter;
    if (column.options?.length) {
      const list = column.options.map((option) => String(option).replace(/[\r\n,]/g, ' ')).join(',');
      for (let row = 2; row <= 200; row += 1) {
        sheet.getCell(`${letter}${row}`).dataValidation = {
          type: 'list',
          allowBlank: !column.required,
          formulae: [`"${list.slice(0, 250)}"`],
          showErrorMessage: true,
          errorTitle: '输入值不在可选范围',
          error: `请选择：${column.options.join(' / ')}`,
        };
      }
    }
  }

  const guide = workbook.addWorksheet('填写说明', { properties: { tabColor: { argb: 'FF10B981' } } });
  guide.columns = [
    { key: 'name', width: 24 },
    { key: 'type', width: 16 },
    { key: 'required', width: 12 },
    { key: 'desc', width: 64 },
  ];
  const title = guide.addRow([`${ciType.name} CI 导入模板 · 填写说明`]);
  guide.mergeCells('A1:D1');
  title.height = 34;
  title.font = { bold: true, size: 16, color: { argb: BRAND_DARK } };
  title.alignment = { vertical: 'middle' };
  const header = guide.addRow(['字段', '类型', '必填', '说明 / 可选值']);
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_DARK } };
  });
  const typeLabel = { text: '文本', textarea: '多行文本', number: '数字', date: '日期', select: '单选', multiselect: '多选' };
  for (const column of columns) {
    const options = column.options?.length ? `可选值：${column.options.join(' / ')}` : '';
    const desc =
      column.key === 'asset_no'
        ? '全局唯一资产编号；用于导入时匹配已有 CI，匹配到则更新，否则新建。'
        : column.key === 'owner_name'
          ? '填写平台用户的姓名、用户名或邮箱，留空表示未分配。'
          : column.key === 'status'
            ? `可选值：${Object.values(STATUS_LABELS).join(' / ')}`
            : column.key === 'criticality'
              ? `可选值：${Object.values(CRITICALITY_LABELS).join(' / ')}`
              : column.key === 'environment'
                ? `可选值：${Object.values(ENVIRONMENT_LABELS).join(' / ')}`
                : options || (column.field_type ? '自定义扩展字段。' : '基础字段。');
    const row = guide.addRow([
      column.header,
      column.field_type ? typeLabel[column.field_type] || '文本' : '文本',
      column.required ? '是' : '否',
      desc,
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    row.height = 30;
  }
  guide.addRow([]);
  const note = guide.addRow(['导入建议', '', '', '单次最多 2000 行；日期格式 YYYY-MM-DD；空行会被跳过；隐藏字段不显示，缺失时由系统自动补齐；导入结果会列出失败行与原因。']);
  note.font = { italic: true, color: { argb: 'FF64748B' } };
  return workbook.xlsx.writeBuffer();
}

export function createCIWorkbook({ ciType, fields, rows, typeMap, hiddenFields = [] }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NextITOps ITSM';
  workbook.created = new Date();
  const columns = buildColumns(fields, hiddenFields);
  columns.push({ key: '__ci_id', header: '系统ID（勿修改）', width: 12 });
  const sheet = workbook.addWorksheet(`${ciType.name}`, { properties: { tabColor: { argb: BRAND } } });
  decorateSheet(sheet, columns);

  rows.forEach((row, rowIndex) => {
    const attributes = parseJson(row.attributes, {});
    const values = columns.map((column) => {
      if (column.key === 'status') return STATUS_LABELS[row.status] || row.status;
      if (column.key === 'criticality') return CRITICALITY_LABELS[row.criticality] || row.criticality;
      if (column.key === 'environment') return ENVIRONMENT_LABELS[row.environment] || row.environment;
      if (column.key === 'owner_name') return row.owner_name || '';
      if (column.key === '__ci_id') return row.id || '';
      if (column.key === 'cost') return Number(row.cost || 0);
      if (column.key.startsWith('attr:')) {
        const value = attributes[column.field_key];
        if (Array.isArray(value)) return value.join('，');
        return value === null || value === undefined ? '' : value;
      }
      return row[column.key] ?? '';
    });
    const excelRow = sheet.addRow(values.map(safeExcelValue));
    excelRow.alignment = { vertical: 'middle' };
    if (rowIndex % 2 === 1) {
      excelRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    }
    if (row.status === 'retired') excelRow.font = { color: { argb: 'FF94A3B8' } };
  });

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (rows.length) sheet.autoFilter = { from: 'A1', to: sheet.getCell(1, columns.length).address };

  const meta = workbook.addWorksheet('导出信息', { properties: { tabColor: { argb: 'FF10B981' } } });
  meta.columns = [{ width: 24 }, { width: 46 }];
  meta.addRow(['导出范围', ciType.name]).font = { bold: true };
  meta.addRow(['CI 类型编码', ciType.code]);
  meta.addRow(['记录数量', rows.length]);
  meta.addRow(['导出时间', new Date().toLocaleString('zh-CN', { hour12: false })]);
  meta.addRow(['说明', '该文件可直接修改后回导；系统ID用于识别原资产，资产编号可修改。']);
  meta.getColumn(1).font = { bold: true, color: { argb: BRAND_DARK } };
  return workbook.xlsx.writeBuffer();
}

export async function parseCIImport({ buffer, ciType, fields, users, hiddenFields = [] }) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Excel 文件中没有可读取的工作表');

  const columns = buildColumns(fields, hiddenFields);
  const hidden = new Set(hiddenFields);
  const headerMap = new Map();
  const normalize = (value) =>
    String(value || '')
      .replace(/\*/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  for (const column of columns) {
    headerMap.set(normalize(column.header), column);
    headerMap.set(normalize(column.key), column);
    if (column.field_key) headerMap.set(normalize(column.field_key), column);
  }

  const headerRow = sheet.getRow(1);
  const columnIndex = new Map();
  let idColumnIndex = null;
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = normalize(cellText(cell.value));
    const column = headerMap.get(header);
    if (column) columnIndex.set(column.key, colNumber);
    if (header === normalize('系统ID（勿修改）') || header === 'ci_id' || header === '系统id') idColumnIndex = colNumber;
  });

  // 导入文件可比模型多列或少列：未知列直接忽略；除资产编号/名称外的模型列缺失时不阻断导入。
  const missingRequired = columns.filter((column) => column.required && !columnIndex.has(column.key) && ['asset_no', 'name'].includes(column.key));
  if (missingRequired.length) {
    throw new Error(`模板缺少必填列：${missingRequired.map((column) => column.header).join('、')}`);
  }

  const ownerMap = new Map();
  for (const user of users) {
    for (const key of [user.name, user.username, user.email]) {
      if (key) ownerMap.set(String(key).trim().toLowerCase(), user.id);
    }
  }

  const rows = [];
  const errors = [];
  let emptyRows = 0;
  const maxRows = Math.min(sheet.rowCount || sheet.actualRowCount || 1, 2001);
  for (let rowNumber = 2; rowNumber <= maxRows; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const record = {};
    let hasValue = false;
    for (const column of columns) {
      const index = columnIndex.get(column.key);
      if (!index) continue;
      const raw = row.getCell(index).value;
      const text = cellText(raw);
      if (text) hasValue = true;
      record[column.key] = { text, raw, column };
    }
    if (!hasValue) {
      emptyRows += 1;
      continue;
    }
    const assetNo = record.asset_no?.text || '';
    if (idColumnIndex) {
      const idValue = cellText(row.getCell(idColumnIndex).value);
      if (idValue) record.__ci_id = { text: idValue, raw: row.getCell(idColumnIndex).value, column: { key: '__ci_id' } };
    }
    const name = record.name?.text || '';
    if (!assetNo && !hidden.has('asset_no')) {
      errors.push({ row: rowNumber, asset_no: '', message: '资产编号不能为空' });
      continue;
    }
    if (!name && !hidden.has('name')) {
      errors.push({ row: rowNumber, asset_no: assetNo, message: '资产名称不能为空' });
      continue;
    }
    if (rows.length >= 2000) {
      errors.push({ row: rowNumber, asset_no: assetNo, message: '单次最多导入 2000 行，后续行已跳过' });
      break;
    }

    const statusLabel = record.status?.text || '';
    const criticalityLabel = record.criticality?.text || '';
    const environmentLabel = record.environment?.text || '';
    const ownerText = (record.owner_name?.text || '').toLowerCase();
    const attributes = {};
    const customErrors = [];
    for (const column of columns.filter((item) => item.key.startsWith('attr:'))) {
      const present = columnIndex.has(column.key);
      const value = record[column.key]?.text || '';
      if (!value) {
        if (column.required && present) customErrors.push(`${column.header}不能为空`);
        continue;
      }
      if (column.field_type === 'number') {
        const numberValue = Number(value);
        if (Number.isNaN(numberValue)) customErrors.push(`${column.header}需为数字`);
        else attributes[column.field_key] = numberValue;
      } else if (column.field_type === 'date') {
        const dateValue = dateText(record[column.key]?.raw);
        if (!dateValue) customErrors.push(`${column.header}日期格式不正确`);
        else attributes[column.field_key] = dateValue;
      } else if (column.field_type === 'multiselect') {
        attributes[column.field_key] = value.split(/[，,;；]/).map((item) => item.trim()).filter(Boolean);
      } else {
        if (column.options?.length && !column.options.includes(value)) {
          customErrors.push(`${column.header}必须为：${column.options.join(' / ')}`);
        }
        attributes[column.field_key] = value;
      }
    }
    if (customErrors.length) {
      errors.push({ row: rowNumber, asset_no: assetNo, message: customErrors.join('；') });
      continue;
    }
    if (statusLabel && !STATUS_REVERSE[statusLabel] && !STATUS_LABELS[statusLabel]) {
      errors.push({ row: rowNumber, asset_no: assetNo, message: `状态值「${statusLabel}」无效` });
      continue;
    }
    if (criticalityLabel && !CRITICALITY_REVERSE[criticalityLabel] && !CRITICALITY_LABELS[criticalityLabel]) {
      errors.push({ row: rowNumber, asset_no: assetNo, message: `关键级别「${criticalityLabel}」无效` });
      continue;
    }
    if (environmentLabel && !ENVIRONMENT_REVERSE[environmentLabel] && !ENVIRONMENT_LABELS[environmentLabel]) {
      errors.push({ row: rowNumber, asset_no: assetNo, message: `环境「${environmentLabel}」无效` });
      continue;
    }
    if (ownerText && !ownerMap.has(ownerText)) {
      errors.push({ row: rowNumber, asset_no: assetNo, message: `负责人「${record.owner_name?.text || ''}」不存在` });
      continue;
    }
    const cost = Number(record.cost?.text || 0);
    rows.push({
      row: rowNumber,
      __ci_id: record.__ci_id?.text ? Number(record.__ci_id.text) : null,
      asset_no: assetNo,
      name,
      status: STATUS_REVERSE[statusLabel] || (STATUS_LABELS[statusLabel] ? statusLabel : 'in_use'),
      criticality: CRITICALITY_REVERSE[criticalityLabel] || (CRITICALITY_LABELS[criticalityLabel] ? criticalityLabel : 'medium'),
      environment: ENVIRONMENT_REVERSE[environmentLabel] || (ENVIRONMENT_LABELS[environmentLabel] ? environmentLabel : 'production'),
      owner_id: ownerText ? ownerMap.get(ownerText) : null,
      department: record.department?.text || '',
      location: record.location?.text || '',
      vendor: record.vendor?.text || '',
      model: record.model?.text || '',
      serial_no: record.serial_no?.text || '',
      ip_address: record.ip_address?.text || '',
      bmc_address: record.bmc_address?.text || '',
      mac_address: record.mac_address?.text || '',
      os_name: record.os_name?.text || '',
      cpu: record.cpu?.text || '',
      memory: record.memory?.text || '',
      disk: record.disk?.text || '',
      purchase_date: dateText(record.purchase_date?.raw),
      warranty_end: dateText(record.warranty_end?.raw),
      cost: Number.isFinite(cost) ? cost : 0,
      description: record.description?.text || '',
      attributes,
      ci_type_id: ciType.id,
    });
  }

  return { rows, errors, emptyRows };
}
