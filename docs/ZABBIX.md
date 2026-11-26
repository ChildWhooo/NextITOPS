# Zabbix 7 对接 NextITops ITSM 配置指南

本文说明如何开启 Zabbix API、创建 API Token、在 NextITops 中配置 Zabbix 集成，以及配置告警 Webhook。

---

## 1. 架构与两种接入方式

NextITops 支持两种 Zabbix 接入方式，可以单独使用，也可以同时使用。

### 方式一：API 主动同步

NextITops 调用 Zabbix JSON-RPC API：

```text
NextITops 服务器  --->  https://zabbix.example.com/api_jsonrpc.php
```

用途：

- 「测试连接」
- 「立即同步」拉取当前 Problem
- 获取 Zabbix 版本、主机数量
- 自动创建事件工单

需要：

- Zabbix API 可访问
- API Token
- Token 所属用户具有主机、触发器、Problem 的读取权限

### 方式二：Zabbix Webhook 推送

Zabbix 发生告警时，主动推送到 NextITops：

```text
Zabbix Server  --->  https://itsm.example.com/api/webhooks/zabbix/...
```

用途：

- 实时接收 Problem / Recovery
- 不依赖轮询
- 可按严重级别、主机、标签、事件名过滤

需要：

- Zabbix 能访问 NextITops 地址
- Zabbix Media type / Action 配置
- NextITops 生成 Webhook 地址和密钥

> 推荐生产环境使用 Webhook 实时接入，API 主动同步作为补拉和连通性验证。

---

## 2. Zabbix 侧：开启 API 并创建 Token

### 2.1 确认 API 地址可访问

Zabbix 7 的 API 默认启用，不需要单独打开全局开关。API 地址固定为：

```text
https://<zabbix-host>/api_jsonrpc.php
```

如果 Zabbix 部署在子路径，例如：

```text
https://<zabbix-host>/zabbix
```

则 API 地址为：

```text
https://<zabbix-host>/zabbix/api_jsonrpc.php
```

在 NextITops 服务器上验证：

```bash
curl -k -sS -X POST 'https://zabbix.example.com/api_jsonrpc.php' \
  -H 'Content-Type: application/json-rpc' \
  -d '{"jsonrpc":"2.0","method":"apiinfo.version","params":{},"id":1}'
```

正常返回示例：

```json
{"jsonrpc":"2.0","result":"7.0.14","id":1}
```

如果返回 404、403、502，请先检查：

- Zabbix Web 前端是否正常
- Nginx/Apache 是否允许访问 `api_jsonrpc.php`
- 反向代理是否透传 `Authorization` 请求头
- 防火墙是否允许 NextITops 服务器访问 Zabbix

### 2.2 创建专用 API 用户（推荐）

不要使用 Zabbix `Admin` 或 `Super Admin` 的长期 Token。

建议创建：

```text
用户名：svc-NextITops
用户角色：只读监控角色
```

最低权限要求：

- 读取主机 `host.get`
- 读取主机接口
- 读取 Problem `problem.get`
- 读取触发器、事件及标签

如果只做 Webhook 推送，不配置 API Token 也可以。

### 2.3 创建 API Token

Zabbix 7 操作路径：

```text
Users → Users → 选择 svc-NextITops → API tokens → Create API token
```

或当前登录用户自己的 Token：

```text
User settings → API tokens → Create API token
```

填写：

| 项目       | 建议                           |
| ---------- | ------------------------------ |
| Name       | `NextITops-itsm`               |
| Expires at | 按组织策略，建议 180 天或 1 年 |
| Enabled    | 开启                           |

创建后 Token 只显示一次，请立即保存到密码管理系统。

### 2.4 验证 Token

```bash
curl -k -sS -X POST 'https://zabbix.example.com/api_jsonrpc.php' \
  -H 'Content-Type: application/json-rpc' \
  -H 'Authorization: Bearer <ZABBIX_API_TOKEN>' \
  -d '{"jsonrpc":"2.0","method":"host.get","params":{"countOutput":true},"id":1}'
```

正常返回：

```json
{"jsonrpc":"2.0","result":"128","id":1}
```

如果返回权限错误，检查 Token 所属用户角色和主机权限。

> NextITops 的「测试连接」会先调用 `apiinfo.version`，该接口可能不需要 Token；如果 Token 无效，界面可能仍显示版本号，但主机数量为空。此时应检查 `host.get` 权限。

---

## 3. NextITops 侧：配置 Zabbix 集成

### 3.1 进入配置页面

```text
集成中心 → Zabbix 集成 → 新增 Zabbix 7 集成
```

需要 `integration.manage` 权限，通常由超级管理员或运维管理员操作。

### 3.2 填写配置

| 字段           | 示例                                | 说明                                                         |
| -------------- | ----------------------------------- | ------------------------------------------------------------ |
| 集成名称       | `生产环境 Zabbix`                   | 自定义名称                                                   |
| Zabbix 地址    | `https://zabbix.example.com/zabbix` | 填 Web 前端根地址，不要填 `/api_jsonrpc.php`；系统会自动拼接 |
| API Token      | `xxxxxxxx`                          | Zabbix API Token；仅 Webhook 模式可留空                      |
| 默认事件流程   | `标准事件处理流程`                  | 自动建单使用的流程                                           |
| 默认负责人     | `张三`                              | 可留空，后续分派                                             |
| 最低严重级别   | `警告及以上`                        | 低于该级别的告警忽略                                         |
| 过滤条件       | 可选                                | 全部条件同时满足才接收                                       |
| 启用集成       | 开启                                | 停用后 Webhook 拒绝接收                                      |
| 仅处理 PROBLEM | 开启                                | 忽略 RECOVERY，不自动建单                                    |
| 告警重开事件   | 开启                                | 已解决工单再次告警时自动重开                                 |

### 3.3 Zabbix 地址填写示例

正确：

```text
https://zabbix.example.com
https://zabbix.example.com/zabbix
http://10.0.0.10/zabbix
```

也支持直接填写：

```text
https://zabbix.example.com/api_jsonrpc.php
```

系统会识别并直接使用。

不要填写：

```text
https://zabbix.example.com/zabbix/
```

虽然通常能处理，但建议去掉末尾 `/`。

### 3.4 测试连接

保存后点击：

```text
测试连接
```

成功时显示：

```text
连接成功 · Zabbix 7.0.14 · 128 台主机 · 35ms
```

如果显示版本但主机数为空：

- Token 可能无效
- Token 用户没有 `host.get` 权限
- Zabbix 角色未授权读取主机

### 3.5 主动同步

点击「立即同步」后，系统调用：

```text
problem.get
```

拉取当前 Problem，按 `event_id + 状态` 去重，并按配置生成事件工单。

主动同步目前是手动触发；如需定时补拉，可由外部调度器调用接口或后续扩展定时任务。

---

## 4. Webhook 配置

### 4.1 生成 Webhook 地址

保存集成后，进入详情页复制：

```text
https://itsm.example.com/api/webhooks/zabbix/zbx_to_itsm
```

这是标准地址，固定不变，使用**第一个启用的集成**。

多套 Zabbix 或多集成场景，使用带密钥的独立地址：

```text
https://itsm.example.com/api/webhooks/zabbix/<webhook_secret>
```

密钥在详情页查看、复制或重置。

### 4.2 配置 Webhook 地址

`PUBLIC_URL` 是浏览器访问系统的地址；Zabbix Webhook 应使用 Zabbix 服务器能直接访问的地址。

```ini
# 用户浏览器访问地址（NAT 后）
PUBLIC_URL=https://192.168.1.8

# Zabbix 服务器访问地址（服务器真实内网地址）
WEBHOOK_PUBLIC_URL=http://10.0.0.8
```

`WEBHOOK_PUBLIC_URL` 不配置时才会回退使用 `PUBLIC_URL`。Zabbix 与 NextITops 同在内网时，建议明确配置为服务器内网地址，避免 Webhook 走到防火墙 NAT 地址。

示例：

```text
Zabbix 服务器：10.0.0.16
NextITops 服务器：10.0.0.8
用户访问地址：https://192.168.1.8

WEBHOOK_PUBLIC_URL=http://10.0.0.8
```

修改后重启：

```bash
sudo systemctl restart NextITops
```

### 4.3 Zabbix 创建 Media type

Zabbix 7 操作路径：

```text
Administration → Media types → Create media type → Webhook
```

配置：

| 项目       | 值                       |
| ---------- | ------------------------ |
| Name       | `NextITops ITSM`         |
| Parameters | `URL` = 上一步复制的地址 |
| Script     | 见下方示例               |
| Timeout    | `10s`                    |
| Enabled    | 开启                     |

Webhook 脚本使用项目自带的：

```text
docs/zabbix7-webhook.js
```

将脚本内容粘贴到 Media type 的 Script 中。它会将 Zabbix 告警转换为 NextITops 可接收的 JSON。

> Zabbix 7 的 `HttpRequest` 对象没有 `setTimeout()` 方法。不要在脚本中调用 `request.setTimeout()`，否则会报 `TypeError: undefined not callable`。超时时间使用媒体类型的「超时」字段配置。

Media type 参数中配置：

| Parameter   | Value                                                      |
| ----------- | ---------------------------------------------------------- |
| `URL`       | `https://itsm.example.com/api/webhooks/zabbix/zbx_to_itsm` |
| `EventID`   | `{EVENT.ID}`                                               |
| `EventName` | `{EVENT.NAME}`                                             |
| `Severity`  | `{EVENT.SEVERITY}`                                         |
| `Status`    | `{EVENT.STATUS}`                                           |
| `Host`      | `{HOST.HOST}`                                              |
| `HostIP`    | `{HOST.IP}`                                                |
| `TriggerID` | `{TRIGGER.ID}`                                             |
| `Tags`      | `{EVENT.TAGSJSON}`                                         |

> 不同 Zabbix 版本的宏和 Webhook 脚本能力略有差异；如果 `{EVENT.TAGSJSON}` 不可用，可先留空或改用 `{EVENT.TAGS}`。

### 4.4 配置用户与动作

1. 创建一个接收告警的 Zabbix 用户，或使用现有运维用户。
2. 在用户「Media」中新增 `NextITops ITSM` 媒体类型，填写接收地址（可填任意占位地址，实际由脚本使用 URL 参数）。
3. 创建 Trigger action：
   - 条件：按需选择严重级别、主机组、标签
   - 操作：Send message → 选择该用户 → 使用 `NextITops ITSM` 媒体类型

### 4.5 测试 Webhook

从 Zabbix Server 或任意可访问 NextITops 的机器执行：

```bash
curl -k -i -X POST 'https://itsm.example.com/api/webhooks/zabbix/zbx_to_itsm' \
  -H 'Content-Type: application/json' \
  -d '{
    "event": {
      "id": "test-1001",
      "name": "Test CPU high on SRV-001",
      "severity": "High",
      "status": "PROBLEM",
      "tags": [{"tag": "service", "value": "erp"}]
    },
    "host": {
      "host": "SRV-001",
      "ip": "10.0.0.11"
    },
    "trigger": {
      "triggerid": "10001"
    }
  }'
```

正常返回：

```json
{"ok":true,"processed":1,"results":[{"accepted":true,"action":"ticket_created","ticket_no":"INC..."}]}
```

如果返回：

```text
404 尚未配置启用的 Zabbix 集成
```

检查集成是否启用。

如果返回：

```text
403 该集成已停用
```

启用对应集成。

### 4.6 安全建议

- 使用 HTTPS
- 不要使用 `/zbx_to_itsm` 标准地址做多租户隔离，优先使用带 `webhook_secret` 的独立地址
- 定期轮换 Webhook 密钥
- 在 Nginx/防火墙限制来源 IP 为 Zabbix Server
- 不要公开 Webhook 地址到互联网搜索引擎
- Webhook 只接收告警数据，不应携带 Zabbix 管理员凭据

---

## 5. 网络与反向代理检查

### 5.1 NextITops 访问 Zabbix

```bash
curl -k -v -X POST 'https://zabbix.example.com/api_jsonrpc.php' \
  -H 'Content-Type: application/json-rpc' \
  -H 'Authorization: Bearer <TOKEN>' \
  -d '{"jsonrpc":"2.0","method":"apiinfo.version","params":{},"id":1}'
```

### 5.2 Zabbix 访问 NextITops

```bash
curl -k -v -X POST 'https://itsm.example.com/api/webhooks/zabbix/zbx_to_itsm' \
  -H 'Content-Type: application/json' \
  -d '{"event":{"id":"net-test","name":"net test","severity":"Warning","status":"PROBLEM"},"host":{"host":"test-host"}}'
```

### 5.3 自签名证书

如果 Zabbix 使用内部 CA 或自签名证书，NextITops 的 Node.js 进程需要信任 CA：

```bash
export NODE_EXTRA_CA_CERTS=/etc/NextITops/zabbix-ca.crt
```

写入 systemd：

```ini
Environment=NODE_EXTRA_CA_CERTS=/etc/NextITops/zabbix-ca.crt
```

然后：

```bash
sudo systemctl daemon-reload
sudo systemctl restart NextITops
```

不要通过设置 `NODE_TLS_REJECT_UNAUTHORIZED=0` 关闭所有 TLS 校验，生产环境不安全。

### 5.4 反向代理 Authorization

如果 Zabbix 前面还有一层 Nginx，确认透传：

```nginx
proxy_set_header Authorization $http_authorization;
```

否则 Bearer Token 会丢失，表现为 401/权限错误。

---

## 6. 常见问题

### 6.1 测试连接成功但没有主机数

`apiinfo.version` 不校验 Token，`host.get` 才校验权限。

检查：

- Token 是否复制完整
- Token 是否过期/停用
- Token 所属用户是否具有主机读取权限
- Zabbix 用户角色是否限制主机组

### 6.2 401 Unauthorized

- Token 错误
- Token 已过期
- 反向代理未透传 `Authorization`
- Zabbix 版本不支持 Bearer Token（本系统按 Zabbix 7 设计）

### 6.3 404 / 502

- Zabbix 地址填写错误
- 子路径少了 `/zabbix`
- Zabbix Web 服务未启动
- Nginx 没有转发到 Zabbix 前端

### 6.4 Webhook 没有生成工单

检查：

- 集成是否启用
- 告警严重级别是否达到「最低严重级别」
- 过滤条件是否全部满足
- 是否开启了「仅处理 PROBLEM」而收到的是 RECOVERY
- Zabbix Action 是否真正执行
- NextITops 是否记录为「已忽略」

### 6.5 生产地址仍是 localhost 或 NAT 地址

配置：

```ini
PUBLIC_URL=https://192.168.1.8
WEBHOOK_PUBLIC_URL=http://10.0.0.8
```

然后重启服务。页面详情页的 Webhook URL 会优先使用 `WEBHOOK_PUBLIC_URL`。

---

## 7. 推荐生产配置清单

- [ ] Zabbix API 地址可从 NextITops 服务器访问
- [ ] 创建专用只读用户 `svc-NextITops`
- [ ] 创建独立 API Token 并设置有效期
- [ ] NextITops 填写 Zabbix 根地址和 Token
- [ ] 配置默认事件流程与负责人
- [ ] 设置最低严重级别
- [ ] 配置 `PUBLIC_URL` 和 `WEBHOOK_PUBLIC_URL`
- [ ] Zabbix 创建 Webhook Media type
- [ ] 配置 Trigger action
- [ ] 从 Zabbix Server 测试 Webhook
- [ ] 在 NextITops 查看告警事件和工单
- [ ] 配置 HTTPS、来源 IP 限制和密钥轮换
- [ ] 不把 Zabbix 管理员 Token 用于集成

---

## 8. 相关系统配置

`.env` 中与 Zabbix 相关的配置：

```ini
# 用户浏览器访问地址
PUBLIC_URL=https://192.168.1.8

# Zabbix 服务器访问 Webhook 的内网地址（优先于 PUBLIC_URL）
WEBHOOK_PUBLIC_URL=http://10.0.0.8

# API 请求超时，默认 10000ms
ZABBIX_TIMEOUT_MS=10000
```

修改后重启：

```bash
sudo systemctl restart NextITops
```

---

## 9. 主机自动发现（混合模式）

### 9.0 两个同步按钮的区别

| 按钮             | 调用                          | 作用                                                      |
| ---------------- | ----------------------------- | --------------------------------------------------------- |
| 立即同步告警消息 | `problem.get` + `trigger.get` | 只同步当前告警，按规则创建事件工单，不写 CMDB 资产        |
| 同步主机         | `host.get`                    | 同步 Zabbix 主机到 CMDB，首次进入待确认队列，后续增量更新 |

「立即同步告警消息」只拉取 Zabbix **当前未恢复的 Problem**；不会把历史已恢复告警重新导入。同步参数中不能使用 `recent: true`，否则 Zabbix 会返回近期已恢复的 Problem。

Zabbix 集成详情页提供：

```text
同步主机
待确认主机
```

### 9.1 首次同步

首次执行「同步主机」时，所有 Zabbix 主机进入「待确认主机」队列，不会直接写入 CMDB。管理员可搜索主机名/IP，分页浏览，批量选择 CI 类型，再点击「保存确认」。

### 9.2 后续增量同步

后续同步按以下规则处理：

- 已有 `zabbix_host_id` 映射：自动更新状态、名称、IP
- 主机标签或主机组能识别类型：自动创建/更新
- 类型无法识别：进入待确认队列
- IP 已被其他在线 CI 占用：进入待确认队列
- 主机名与其他 CI 冲突：进入待确认队列

### 9.3 类型识别

优先级：

1. 主机标签：

```text
cmdb.type=server
cmdb.type=storage
cmdb.type=network
cmdb.type=security
cmdb.type=pm
cmdb.type=virtualization
cmdb.type=vm
```

2. 主机组名称：

```text
server / storage / network / security / pm / virtualization / vm
```

3. 主机 Inventory 的 `type` 字段

`pm` 映射到 CMDB `server` 类型；`virtualization host` 映射到 `virtualization`。

`null`、空类型、`127.0.0.1` 等非完整主机会进入待确认队列，不会自动入库。

### 9.4 主机下线

Zabbix 中主机被删除或停用后：

- 对应 CI 状态改为 `offline`
- IP 记录保留
- `ci_ips.status` 改为 `offline`
- 前端 IP 状态显示为灰色

### 9.5 IP 复用

新主机使用一个属于已下线 CI 的 IP 时：

- 旧 CI 保持 `offline`
- 旧 IP 记录标记为 `released`
- 新主机创建新的 CI 和 active IP 记录

在线 CI 的 IP 被其他主机占用时不会自动覆盖，而是进入待确认队列。

### 9.6 自动同步

服务启动后默认每 5 分钟自动对启用的 Zabbix 集成执行一次主机增量对账；首次同步仍会全部进入待确认队列。

可通过 `.env` 调整：

```ini
ZABBIX_HOST_SYNC_MINUTES=5
# 关闭自动同步
# ZABBIX_HOST_SYNC_DISABLED=1
```

管理员仍可在集成详情页手动点击「同步主机」立即执行。

### 9.7 CPU、内存、磁盘采集（方案 A 已实现）

Zabbix 集成详情页提供「同步主机配置」，使用标准 Agent Item：

| 配置       | 推荐 Item Key                                                                                                                               | 单位  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| CPU 核心数 | Linux：`system.cpu.num` / `system.cpu.cores`<br>Windows：`wmi.get[root/cimv2,"Select NumberOfLogicalProcessors from Win32_ComputerSystem"]` | 个    |
| 内存总量   | `vm.memory.size[total]`                                                                                                                     | bytes |
| 磁盘总量   | 所有 `vfs.fs.dependent.size[<分区>,total]` 之和（兼容旧版 `vfs.fs.size[...]`）                                                              | bytes |

Zabbix 7 LTS 使用 `vfs.fs.dependent.size[/,total]`、`vfs.fs.dependent.size[C:,total]` 等依赖项。磁盘同步会遍历该主机全部分区的 `,total` Item，排除 `/boot`、SWAP、tmpfs、proc、sysfs 等伪文件系统，然后把其余分区容量相加，写入 `cis.disk` 总容量。

Windows 的 `C:`、`D:` 等盘符会一并汇总；Linux 的 `/`、`/home`、`/data` 等独立分区也会汇总。

同步结果写入：

- `cis.cpu`
- `cis.memory`
- `cis.disk`

只填充空字段或上一次由 Zabbix 自动写入的字段，不覆盖人工维护的数据。同步记录保存在 `cis.attributes.zabbix_specs`。

自动对账时也会在主机同步后尝试刷新这些配置；手动点击「同步主机配置」可立即刷新。

### 9.8 操作系统与 MAC 地址

Agent 主机可额外采集：

| 配置     | Item Key                                               |
| -------- | ------------------------------------------------------ |
| 操作系统 | `system.sw.os` / `system.sw.os[name]` / `system.uname` |
| MAC 地址 | `system.hw.macaddr[<接口>,full]`                       |

MAC 使用 `system.hw.macaddr` 的 LLD 发现项，自动排除回环和全零地址；写入 `cis.mac_address`。如果 Zabbix 模板没有启用 MAC 发现项，该字段会保持为空。

操作系统和 MAC 只在 CMDB 字段为空时填充，避免覆盖人工维护数据。

### 9.9 磁盘同步排查

如果磁盘仍为空，在 Zabbix 服务器或 NextITops 服务器执行：

```bash
curl -sS -X POST 'http://<zabbix>/api_jsonrpc.php' \
  -H 'Content-Type: application/json-rpc' \
  -H 'Authorization: Bearer <TOKEN>' \
  -d '{"jsonrpc":"2.0","method":"item.get","params":{"output":["itemid","hostid","key_","lastvalue","units","value_type"],"hostids":["<HOSTID>"],"search":{"key_":"vfs.fs.size["}},"id":1}' | jq .
```

需要确认：

- 至少返回 `vfs.fs.size[/,total]` 或 `vfs.fs.size[C:,total]`
- `lastvalue` 有数值，或 `history.get` 能取到最近值
- Token 有 `item.get`、`history.get` 权限
- 磁盘项是已启用的 Item，不是未展开的 Item prototype

如果 `item.get` 返回空，说明 Zabbix 没有采集到文件系统，不是 NextITops 同步问题。

### 9.10 操作系统名称与内核版本映射

Zabbix 的 `system.sw.os` 原始值通常很长，系统会先映射为可读名称：

```text
el6 → Redhat6
el7 → CentOS7
el8 → CentOS8
el9 → RockyLinux8
```

Windows 会自动提取：

```text
Windows Server 2016 Standard
Windows Server 2008 R2 Enterprise
Windows 10 Enterprise
```

映射后的名称写入 `cis.os_name`，并自动创建/更新对应的「操作系统」类型 CI：

- 主机 → 操作系统使用 `os_installed` 关系
- 操作系统的 `kernel_version` 写入内核版本
- 原始值保存在 `attributes.zabbix_os_raw`

Linux 内核示例：

```text
Linux version 3.10.0-1160.21.1.el7.x86_64
→ 3.10.0-1160.21.1.el7.x86_64
```

Windows 内核示例：

```text
Build 7601.28117
→ 7601.28117
```

Zabbix 集成页面的「OS 映射」按钮可以维护 `原始值关键字 → 显示名称` 规则。

---

## 10. 版本说明

本文按 Zabbix 7.x 与 NextITops v1.1.20261109 编写。

Zabbix 5.4/6.0 也支持 API Token，但宏、Webhook 脚本和菜单路径可能与本文略有差异；升级前请先在测试环境验证。
