# NextITops v1.0.20261106 生产环境部署说明

> 适用版本：**v1.0.20261106**  
> 生产数据库：**MySQL 8.4 LTS** 或 **PostgreSQL 16/17**（二选一）  
> 适用系统：Linux（Ubuntu 22.04/24.04 LTS、Rocky Linux 9、openEuler 22.03 LTS）

---

## 1. 生产架构

```text
用户浏览器
   │ HTTPS 443
   ▼
Nginx（TLS 终止、静态资源、反向代理、安全响应头、限流）
   ├── /            → dist 静态文件（React 构建产物）
   └── /api/*       → Node.js / Fastify (127.0.0.1:8080)
                         └── MySQL 8.4 (127.0.0.1:3306)
                             或 PostgreSQL 16/17 (127.0.0.1:5432)
```

生产环境只暴露 Nginx 的 443/80，**Node.js、MySQL/PostgreSQL 均只监听 127.0.0.1**，不直接暴露公网。两种数据库按企业现有标准二选一，不要同时连接。

---

## 2. 主机与依赖要求

### 2.1 推荐配置

| 项目       | 建议                                          |
| ---------- | --------------------------------------------- |
| CPU / 内存 | 4 vCPU / 8 GB 起步；数据量大时 8 vCPU / 16 GB |
| 磁盘       | 100 GB SSD 起，数据库与附件分盘更佳           |
| Node.js    | **24.x LTS**                                  |
| MySQL      | **8.4 LTS**（可选，与 PostgreSQL 二选一）     |
| PostgreSQL | **16 / 17**（可选，与 MySQL 二选一）          |
| Nginx      | 1.24+                                         |
| 操作系统   | 64 位 Linux，启用 SELinux/AppArmor            |
| 时间同步   | chrony/systemd-timesyncd 必须启用             |

### 2.2 支持的操作系统

| 系统家族                     | 版本建议          | 包管理器 | 服务管理  |
| ---------------------------- | ----------------- | -------- | --------- |
| Ubuntu                       | 22.04 / 24.04 LTS | `apt`    | `systemd` |
| Debian                       | 12 Bookworm       | `apt`    | `systemd` |
| RHEL                         | 8.8+ / 9.2+       | `dnf`    | `systemd` |
| Rocky Linux / AlmaLinux      | 8.8+ / 9.2+       | `dnf`    | `systemd` |
| CentOS Stream                | 9                 | `dnf`    | `systemd` |
| SUSE Linux Enterprise Server | 15 SP5+           | `zypper` | `systemd` |
| openSUSE Leap                | 15.5+             | `zypper` | `systemd` |

> 生产环境优先选择厂商仍提供安全更新的 LTS/稳定版本；不建议使用已 EOL 的 CentOS 7/8。

### 2.3 Debian / Ubuntu 安装依赖

```bash
sudo apt update
sudo apt install -y curl ca-certificates gnupg lsb-release nginx chrony ufw

# MySQL 8.4 官方 APT 仓库（安装时选择 MySQL 8.4）
wget https://repo.mysql.com/mysql-apt-config_0.8.34-1_all.deb -O /tmp/mysql-apt-config.deb
sudo dpkg -i /tmp/mysql-apt-config.deb
sudo apt update
sudo apt install -y mysql-server

# Node.js 24（NodeSource）
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# pnpm
sudo corepack enable
sudo corepack prepare pnpm@latest --activate
```

如果 `mysql-apt-config` 版本号已更新，请从 <https://dev.mysql.com/downloads/repo/apt/> 获取最新包。

### 2.4 RHEL / Rocky Linux / AlmaLinux / CentOS Stream

```bash
# 基础依赖
sudo dnf install -y curl ca-certificates nginx chrony firewalld policycoreutils-python-utils

# MySQL 8.4 Community 仓库（RHEL/Rocky 9 使用 el9；RHEL/Rocky 8 使用 el8）
sudo dnf install -y https://dev.mysql.com/get/mysql84-community-release-el9-1.noarch.rpm
sudo dnf install -y mysql-community-server

# Node.js 24（NodeSource）
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo -E bash -
sudo dnf install -y nodejs

# pnpm
sudo corepack enable
sudo corepack prepare pnpm@latest --activate

# 服务
sudo systemctl enable --now mysqld
sudo systemctl enable --now nginx
sudo systemctl enable --now chronyd firewalld
```

RHEL 8 将 `el9` 替换为 `el8`。如企业环境使用内部镜像源，请将 MySQL/NodeSource 仓库同步到内部仓库后再安装。

SELinux 开启时，Nginx 反向代理 Node.js 需要允许网络连接：

```bash
sudo setsebool -P httpd_can_network_connect 1
```

### 2.5 SUSE Linux Enterprise Server / openSUSE Leap

```bash
# 基础依赖
sudo zypper refresh
sudo zypper install -y curl ca-certificates nginx chrony firewalld

# MySQL 8.4 Community 仓库（SLES 15）
sudo rpm -Uvh https://dev.mysql.com/get/mysql84-community-release-sles15-1.noarch.rpm
sudo zypper install -y mysql-community-server

# Node.js 24（NodeSource RPM 仓库）
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo -E bash -
sudo zypper install -y nodejs

# pnpm
sudo corepack enable
sudo corepack prepare pnpm@latest --activate

# 服务
sudo systemctl enable --now mysql
sudo systemctl enable --now nginx
sudo systemctl enable --now chronyd firewalld
```

openSUSE Leap 如无法直接使用 SLES 15 的 MySQL 仓库，请使用厂商提供的 MySQL 8.4 软件源或经安全团队批准的官方容器镜像，不要混用 MariaDB 数据目录。

### 2.6 通用验证

```bash
node -v          # 应为 v24.x
nginx -v         # 应为 1.24+
mysql --version  # 应为 8.4.x
systemctl status mysql 2>/dev/null || systemctl status mysqld
```

### 2.7 防火墙与时间同步

```bash
# firewalld（RHEL/Rocky/SUSE）
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload

# ufw（Ubuntu/Debian）
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# 时间同步
sudo timedatectl set-ntp true
timedatectl status
```

> 3306/5432 与 8080 不对公网开放。Node.js 只监听 `127.0.0.1:8080`，MySQL/PostgreSQL 只监听 `127.0.0.1:3306/5432`。

> 生产机不要安装开发依赖；如使用 `pnpm install --prod`，构建阶段需在 CI/构建机完成，生产机只部署 `dist` 与运行时依赖。

---

## 3. 数据库初始化（MySQL 8.4 或 PostgreSQL 16/17）

> 两种数据库二选一。下文 MySQL 与 PostgreSQL 章节均保留，按企业标准选择其一部署。

### 3.1 创建数据库与专用账号

```sql
CREATE DATABASE NextITops
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE USER 'NextITops'@'127.0.0.1'
  IDENTIFIED BY '<使用 32 位以上随机密码>';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON NextITops.* TO 'NextITops'@'127.0.0.1';

FLUSH PRIVILEGES;
```

不要授予 `ALL PRIVILEGES`、`FILE`、`SUPER`、`PROCESS` 等管理权限。

### 3.2 强制本地监听与安全基线

`/etc/mysql/mysql.conf.d/mysqld.cnf`：

```ini
[mysqld]
bind-address = 127.0.0.1
mysqlx-bind-address = 127.0.0.1
skip-name-resolve = 1
local_infile = 0
secure_file_priv = /var/lib/mysql-files
require_secure_transport = ON
max_connections = 200
character-set-server = utf8mb4
collation-server = utf8mb4_0900_ai_ci

# TLS（使用企业 CA 或自签并妥善保管）
ssl_ca = /etc/mysql/certs/ca.pem
ssl_cert = /etc/mysql/certs/server-cert.pem
ssl_key = /etc/mysql/certs/server-key.pem
```

MySQL 配置路径与服务名因发行版而异：

| 系统                                | 配置文件                             | 服务名   |
| ----------------------------------- | ------------------------------------ | -------- |
| Ubuntu / Debian                     | `/etc/mysql/mysql.conf.d/mysqld.cnf` | `mysql`  |
| RHEL / Rocky / Alma / CentOS Stream | `/etc/my.cnf.d/mysql-server.cnf`     | `mysqld` |
| SLES / openSUSE                     | `/etc/my.cnf`                        | `mysql`  |

执行：

```bash
sudo mysql_secure_installation
sudo systemctl enable --now mysql   # RHEL 系使用 mysqld
```

确认端口未监听公网：

```bash
ss -lntp | grep 3306   # 应仅见 127.0.0.1:3306
```

### 3.3 数据库备份

```bash
# 每日逻辑备份（示例）
mysqldump --single-transaction --routines --triggers \
  -u NextITops -p NextITops | gzip > /backup/NextITops-$(date +%F).sql.gz
```

备份文件必须加密/限权保存，并定期做恢复演练。

---

### 3.4 PostgreSQL 16/17 安装与初始化

PostgreSQL 作为 MySQL 的替代方案，应用通过 `pg` 驱动连接，支持 PostgreSQL 16/17。

#### 3.4.1 安装 PostgreSQL

**Ubuntu / Debian（PGDG 官方仓库）：**

```bash
sudo apt install -y curl ca-certificates gnupg lsb-release
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release; echo $VERSION_CODENAME)-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt update
sudo apt install -y postgresql-17 postgresql-client-17
```

**RHEL / Rocky Linux / AlmaLinux / CentOS Stream 9：**

```bash
sudo dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm
sudo dnf -qy module disable postgresql
sudo dnf install -y postgresql17-server postgresql17-contrib
sudo /usr/pgsql-17/bin/postgresql-17-setup initdb
sudo systemctl enable --now postgresql-17
```

RHEL/Rocky 8 将仓库地址中的 `EL-9` 替换为 `EL-8`，软件包中的 `17` 按实际安装版本调整。

**SUSE Linux Enterprise Server / openSUSE Leap：**

```bash
# SLES 15 SP5；openSUSE Leap 请将仓库路径替换为对应版本
sudo zypper addrepo https://download.opensuse.org/repositories/server:database:postgresql/SLES_15_SP5/server:database:postgresql.repo
sudo zypper refresh
sudo zypper install -y postgresql17-server postgresql17-contrib
sudo systemctl enable --now postgresql
```

> 各发行版仓库路径与包名可能随版本调整，安装前以 PostgreSQL 官方文档和企业内部镜像源为准；不要混用不同大版本的二进制目录与数据目录。

#### 3.4.2 创建数据库与专用账号

```bash
sudo -u postgres psql
```

```sql
CREATE USER NextITops WITH PASSWORD '<使用 32 位以上随机密码>';
CREATE DATABASE NextITops
  OWNER NextITops
  ENCODING 'UTF8'
  LC_COLLATE 'C'
  TEMPLATE template0;
\c NextITops
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO NextITops;
\q
```

#### 3.4.3 本地监听、TLS 与访问控制

编辑 `postgresql.conf`（路径通常为 `/etc/postgresql/17/main/postgresql.conf` 或 `/var/lib/pgsql/17/data/postgresql.conf`）：

```ini
listen_addresses = 'localhost'
port = 5432
password_encryption = scram-sha-256
ssl = on
ssl_cert_file = '/etc/postgresql/certs/server-cert.pem'
ssl_key_file = '/etc/postgresql/certs/server-key.pem'
```

`pg_hba.conf` 只允许本机应用账号：

```text
local   all             postgres                                peer
host    NextITops         NextITops         127.0.0.1/32            scram-sha-256
host    NextITops         NextITops         ::1/128                 scram-sha-256
```

```bash
sudo systemctl restart postgresql   # RHEL 系为 postgresql-17
sudo ss -lntp | grep 5432           # 应仅监听 127.0.0.1:5432
```

如应用与数据库跨主机部署，必须使用 TLS 并限制来源网段；不要将 5432 暴露到公网。生产建议应用与数据库同机或置于同一私有网络。

#### 3.4.4 应用环境变量（PostgreSQL）

```ini
DB_CLIENT=pg
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=NextITops
DB_USER=NextITops
DB_PASSWORD=<数据库强密码>
DB_SSL=true
DB_POOL_MAX=5
```

#### 3.4.5 PostgreSQL 备份

```bash
# 自定义格式备份，便于 pg_restore
pg_dump -Fc -U NextITops -h 127.0.0.1 NextITops > /backup/NextITops-$(date +%F).dump

# 恢复示例
pg_restore -U NextITops -h 127.0.0.1 -d NextITops --clean --if-exists /backup/NextITops-2026-11-06.dump
```

备份文件必须加密、限权保存，并定期做恢复演练。

---

## 4. 应用部署

### 4.1 目录与运行用户

```bash
sudo useradd --system --home /data/NextITops --shell /usr/sbin/nologin NextITops
sudo mkdir -p /data/NextITops /var/log/NextITops
sudo chown -R NextITops:NextITops /data/NextITops /var/log/NextITops
```

将发布包解压到 `/data/NextITops`，应用位于 `/data/NextITops/app`：

```text
/data/NextITops/
└── app/
    ├── dist/               # 前端构建产物（唯一可公开目录）
    ├── server/             # 后端代码
    ├── package.json
    ├── pnpm-lock.yaml
    ├── node_modules/       # 生产依赖
    └── .env                # 权限 600，绝不能放入 dist
```

### 4.2 环境变量

```bash
cd /data/NextITops/app
sudo -u NextITops cp .env.example .env
sudo chmod 600 /data/NextITops/app/.env
```

生产 `.env` 示例：

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=8080
PUBLIC_URL=https://NextITops.example.com
CORS_ORIGIN=https://NextITops.example.com

# 使用 `openssl rand -base64 48` 生成，禁止使用示例值
JWT_SECRET=<64位以上随机字符串>
JWT_EXPIRES_IN=12h

# 首次初始化建表/基础数据后改为 false
AUTO_SEED=true
LOG_LEVEL=warn

# Node 多进程：4C 建议 4；开发环境保持 0
CLUSTER_WORKERS=4
DB_POOL_MAX=5

# ---------- 数据库：MySQL 8.4 或 PostgreSQL 16/17 二选一 ----------
# MySQL
DB_CLIENT=mysql2
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=NextITops
DB_USER=NextITops
DB_PASSWORD=<数据库强密码>
DB_SSL=true
DB_POOL_MAX=5

# PostgreSQL（使用 PostgreSQL 时注释掉上面的 MySQL 配置，启用以下配置）
# DB_CLIENT=pg
# DB_HOST=127.0.0.1
# DB_PORT=5432
# DB_NAME=NextITops
# DB_USER=NextITops
# DB_PASSWORD=<数据库强密码>
# DB_SSL=true
# DB_POOL_MAX=5

ZABBIX_TIMEOUT_MS=10000
```

首次启动完成建表与基础数据初始化后，将：

```ini
AUTO_SEED=false
```

### 4.3 安装依赖与构建

在构建机执行（不要在生产机保留前端源码）：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

把 `dist/`、`server/`、`package.json`、`pnpm-lock.yaml`、生产依赖部署到生产机。

### 4.4 systemd 服务

`/etc/systemd/system/NextITops.service`：

```ini
[Unit]
Description=NextITops ITSM
After=network.target mysql.service
Wants=mysql.service

[Service]
Type=simple
User=NextITops
Group=NextITops
WorkingDirectory=/data/NextITops/app
EnvironmentFile=/data/NextITops/app/.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/data/NextITops/app/data /var/log/NextITops
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now NextITops
sudo systemctl status NextITops
curl -fsS http://127.0.0.1:8080/api/health
```

---

### 4.5 Node.js 多进程

4C 机器建议在 `.env` 中启用：

```ini
CLUSTER_WORKERS=4
DB_POOL_MAX=5
LOG_LEVEL=warn
```

`server/index.js` 使用 Node.js `cluster`：

- 主进程执行一次数据库 schema 初始化
- 4 个 worker 共享 `127.0.0.1:8080` 端口
- 每个 worker 独立处理请求和数据库连接池
- Nginx 仍只需代理 `127.0.0.1:8080`
- systemd 停止服务时会一并结束所有 worker

`CLUSTER_WORKERS=0` 表示单进程，开发环境保持 0 即可。

> 登录失败计数目前是进程内计数。启用多 worker 后，需同时依赖 Nginx 的登录接口限流；生产必须保留 `limit_req` 配置。

---

## 5. Nginx 与 HTTPS

`/etc/nginx/conf.d/NextITops.conf`：

```nginx
limit_req_zone $binary_remote_addr zone=NextITops_login:10m rate=10r/m;

upstream NextITops_backend {
    server 127.0.0.1:8080;
    keepalive 32;
}

gzip on;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_vary on;
gzip_proxied any;
gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml image/svg+xml;

server {
    listen 80;
    server_name NextITops.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name NextITops.example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:20m;
    ssl_session_timeout 1d;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # 注意：高德 JS API 需要以下来源；按实际使用调整
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-eval' https://webapi.amap.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://webapi.amap.com https://restapi.amap.com; connect-src 'self' https://restapi.amap.com https://webapi.amap.com; font-src 'self' data:; worker-src 'self' blob:; frame-ancestors 'self';" always;

    root /data/NextITops/app/dist;
    index index.html;

    # 禁止目录浏览
    autoindex off;

    # 禁止访问源码、环境变量、映射文件、隐藏文件
    location ~ /\.(?!well-known) { deny all; }
    location ~* \.(map|env|log|sql|bak|ini|conf)$ { deny all; }
    location ^~ /server/ { deny all; }
    location ^~ /web/ { deny all; }

    # 登录接口限流
    location = /api/auth/login {
        limit_req zone=NextITops_login burst=5 nodelay;
        proxy_pass http://NextITops_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    location /api/ {
        proxy_pass http://NextITops_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        client_max_body_size 20m;
    }

    # 带 hash 的静态资源长期缓存
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    # SPA 路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }
}

open_file_cache max=1000 inactive=30s;
open_file_cache_valid 60s;
open_file_cache_min_uses 2;
open_file_cache_errors on;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

生产环境必须使用有效证书（企业 CA 或 Let's Encrypt），禁止长期使用自签证书。

---

## 6. 应用安全配置

### 6.1 必须修改的默认项

1. 修改 `admin` 初始密码，并启用密码策略。
2. 修改 `JWT_SECRET`，不得使用示例值。
3. 将 `CORS_ORIGIN` 固定为生产域名，不要留空反射任意 Origin。
4. 设置 `AUTO_SEED=false`，防止重启重复初始化。
5. 高德 API Key 设置域名白名单/安全密钥，禁止在前端暴露服务端 Key。
6. 关闭不必要的通知渠道、Zabbix 集成和外部 API 配置。
7. 登录安全中设置失败锁定、IP 白名单、无操作自动注销。

### 6.2 防止源代码/敏感文件泄露

前端 React 代码经 Vite 打包后仍是可读 JavaScript，**不能把“混淆”当作安全边界**。生产必须做到：

- 只公开 `dist/`；不要将 `web/src`、`server/`、`.env`、数据库文件放入 Web 根目录。
- 不生成/不上传 source map；构建后确认 `dist/assets/*.map` 不存在。
- Nginx 拒绝 `.map`、`.env`、`.git`、`.sql`、`.log`、隐藏文件。
- 关闭 `autoindex`，禁止目录列表。
- API 全部经过 JWT/RBAC 鉴权，前端隐藏菜单不等于权限控制。
- 不在前端写数据库密码、JWT_SECRET、Zabbix/邮件服务端密钥。
- 使用 WAF 或 Nginx 限流防暴力破解、爬虫批量拉取；对登录、导出、导入接口单独限流。
- 设置 `robots.txt` 禁止收录，但不要依赖 robots 做访问控制。

### 6.3 操作系统加固

- 关闭 root 远程登录，仅使用 SSH Key，限制来源 IP。
- 启用防火墙，仅开放 80/443 和必要的运维跳板访问。
- 启用 SELinux/AppArmor，Node 进程使用独立低权限用户。
- 启用 unattended-upgrades 或定期补丁窗口。
- 禁用未使用的服务/端口；数据库、Redis 等只监听本地。
- 日志集中收集，设置磁盘配额与日志轮转。
- 文件权限：`.env` 600，上传目录不可执行，部署目录属主为运行用户。

### 6.4 传输与响应头

- 强制 HTTPS，启用 HSTS。
- 配置 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、CSP。
- Cookie/JWT 不放入 URL；生产使用短会话与无操作自动注销。
- 反向代理传递真实 IP，登录安全 IP 白名单才能生效。

---

## 7. 生产数据基线

正式发版数据要求：

- 仅保留 `admin`（姓名：管理员）与 `auditor`（姓名：审计管理员）
- 角色权限保留
- CI 类型、扩展字段定义保留
- IT 流程设计（工作流/阶段）保留
- CI 资产、工单、维护公告、审计日志、监控告警清空
- 高德 API 配置保留

MySQL 首次初始化后如需清空演示数据，可在确认备份后执行（示例，按实际表名调整）：

```sql
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE ticket_attachments;
TRUNCATE TABLE ticket_comments;
TRUNCATE TABLE ticket_stage_history;
TRUNCATE TABLE ticket_cis;
TRUNCATE TABLE ticket_relations;
TRUNCATE TABLE ticket_deletion_requests;
TRUNCATE TABLE tickets;
TRUNCATE TABLE ci_acl;
TRUNCATE TABLE ci_change_logs;
TRUNCATE TABLE ci_deletion_requests;
TRUNCATE TABLE ci_ips;
TRUNCATE TABLE ci_network_ports;
TRUNCATE TABLE ci_relations;
TRUNCATE TABLE datacenter_links;
TRUNCATE TABLE rack_placements;
TRUNCATE TABLE rack_profiles;
TRUNCATE TABLE rich_attachments;
TRUNCATE TABLE cis;
TRUNCATE TABLE ip_assets;
TRUNCATE TABLE ip_assignment_history;
TRUNCATE TABLE ip_subnets;
TRUNCATE TABLE maintenance_notices;
TRUNCATE TABLE audit_logs;
TRUNCATE TABLE zabbix_events;
TRUNCATE TABLE notification_logs;
DELETE FROM users WHERE username NOT IN ('admin','auditor');
UPDATE users SET name='管理员' WHERE username='admin';
UPDATE users SET name='审计管理员' WHERE username='auditor';
SET FOREIGN_KEY_CHECKS = 1;
```

> 执行前必须备份；不要在生产运行 `pnpm seed` 的 `--reset`。

PostgreSQL 首次初始化后清空演示数据（确认备份后执行）：

```sql
BEGIN;

TRUNCATE TABLE ticket_attachments, ticket_comments, ticket_stage_history,
  ticket_cis, ticket_relations, ticket_deletion_requests, tickets
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE ci_acl, ci_change_logs, ci_deletion_requests, ci_ips,
  ci_network_ports, ci_relations, datacenter_links, rack_placements,
  rack_profiles, rich_attachments, cis
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE ip_assets, ip_assignment_history, ip_subnets
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE maintenance_notices, audit_logs, zabbix_events, notification_logs
  RESTART IDENTITY CASCADE;

DELETE FROM users WHERE username NOT IN ('admin', 'auditor');
UPDATE users SET name = '管理员' WHERE username = 'admin';
UPDATE users SET name = '审计管理员' WHERE username = 'auditor';

COMMIT;
```

> PostgreSQL 的 `TRUNCATE ... CASCADE` 会清理关联表，执行前务必确认备份与表清单。

---

## 8. 上线检查清单

- [ ] MySQL 8.4 或 PostgreSQL 16/17 仅监听 127.0.0.1，使用强密码与最小权限
- [ ] Node.js 24，`NODE_ENV=production`，`AUTO_SEED=false`
- [ ] `JWT_SECRET` 已更换，CORS 固定生产域名
- [ ] HTTPS 证书有效，HSTS/CSP/安全响应头生效
- [ ] Nginx 禁止访问源码、`.env`、`.map`、隐藏文件
- [ ] 登录限流、失败锁定、IP 白名单已配置
- [ ] 管理员密码已修改，仅保留管理员/审计管理员
- [ ] 资产、工单、公告、审计日志已清空
- [ ] 高德 API Key 已配置域名白名单并保留
- [ ] 数据库备份、日志轮转、监控告警已配置
- [ ] `/api/health` 返回正常，页面登录与核心流程验收通过
- [ ] 完成恢复演练与安全扫描（端口、弱口令、目录遍历、源码泄露）
