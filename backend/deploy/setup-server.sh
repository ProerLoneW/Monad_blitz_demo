#!/usr/bin/env bash
# =============================================================================
# ProofNote 后端服务器一键环境脚本（幂等，可重复执行）
#
# 适用：Debian / Ubuntu（apt 系）；其他发行版请参照 README 手动安装
# 前置：项目代码已在服务器上（git clone 或 scp 到任意目录）
#
# 用法：
#   bash backend/deploy/setup-server.sh
#
# 可选环境变量（覆盖默认值）：
#   PORT=8080                  API 端口
#   SKIP_SYSTEMD=1             不注册 systemd（手动 pnpm start:api 前台运行）
#   SKIP_POSTGRES=1            服务器已自带 Postgres（需在 .env 写好 DATABASE_URL）
#   PG_USER / PG_PASSWORD / PG_DB   本机新建 Postgres 的用户/密码/库名
#
# 脚本做的事：
#   1. 基础包（curl 等）
#   2. Node.js ≥ 20（已有则跳过；NodeSource 失败自动换 npmmirror 二进制）
#   3. pnpm 9（npmjs 失败自动换腾讯镜像）
#   4. PostgreSQL 安装/启动 + 建用户建库（密码随机生成，或沿用 .env 中已有的）
#   5. pnpm install（仓库 .npmrc 已指向腾讯镜像）
#   6. 生成/校对 .env（API_BASE_URL 自动填服务器公网/内网 IP）
#   7. pnpm db:push 建表
#   8. systemd 常驻服务 proofnote-api / proofnote-indexer 并启动
#   9. 健康检查 + 输出摘要与后续步骤
# =============================================================================
set -euo pipefail

# ── 颜色与日志 ───────────────────────────────────────────────
info()  { printf '\033[1;32m[ SETUP ]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[ WARN  ]\033[0m %s\n' "$*"; }
fail()  { printf '\033[1;31m[ FAIL  ]\033[0m %s\n' "$*" >&2; exit 1; }

# ── 路径与默认值 ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
[ -f "${BACKEND_DIR}/package.json" ] || fail "未找到 ${BACKEND_DIR}/package.json，请在项目 backend/deploy/ 下运行本脚本"

PORT="${PORT:-8080}"
PG_USER="${PG_USER:-proofnote}"
PG_DB="${PG_DB:-proofnote}"
NODE_MAJOR_MIN=20
NODE_VERSION_FALLBACK="20.18.1"   # npmmirror 二进制兜底版本
PNPM_VERSION="9.15.9"

# root / sudo
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || fail "非 root 且无 sudo，请用 root 运行或安装 sudo"
  SUDO="sudo"
fi

# ── 0. 系统检查 ──────────────────────────────────────────────
info "系统检查"
command -v apt-get >/dev/null 2>&1 || fail "本脚本面向 Debian/Ubuntu（apt）。其他发行版请手动安装 Node20+/pnpm9/Postgres16+ 后重跑（会自动跳过已装部分）"
${SUDO} apt-get update -qq

info "安装基础包（curl ca-certificates gnupg xz-utils）"
${SUDO} apt-get install -y -qq curl ca-certificates gnupg xz-utils >/dev/null

# ── 1. Node.js ≥ 20 ─────────────────────────────────────────
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v; v="$(node -v | sed 's/^v//' | cut -d. -f1)"
  [ "${v}" -ge "${NODE_MAJOR_MIN}" ]
}

if node_ok; then
  info "Node.js 已就绪：$(node -v)（跳过安装）"
else
  info "安装 Node.js ${NODE_MAJOR_MIN}+（先试 NodeSource 源）"
  if curl -fsSL --connect-timeout 8 "https://deb.nodesource.com/setup_20.x" | ${SUDO} bash - >/dev/null 2>&1 \
     && ${SUDO} apt-get install -y -qq nodejs >/dev/null 2>&1 && node_ok; then
    info "NodeSource 安装成功：$(node -v)"
  else
    warn "NodeSource 不可达，改用 npmmirror 二进制包（国内服务器常见路径）"
    ARCH="$(uname -m)"; case "${ARCH}" in x86_64) NODE_ARCH=x64;; aarch64|arm64) NODE_ARCH=arm64;; *) fail "不支持的架构 ${ARCH}";; esac
    TARBALL="node-v${NODE_VERSION_FALLBACK}-linux-${NODE_ARCH}.tar.xz"
    URL="https://cdn.npmmirror.com/binaries/node/v${NODE_VERSION_FALLBACK}/${TARBALL}"
    TMPD="$(mktemp -d)"
    curl -fsSL --connect-timeout 10 -o "${TMPD}/${TARBALL}" "${URL}" || fail "Node 下载失败：${URL}（请检查服务器网络或手动安装）"
    ${SUDO} tar -xJf "${TMPD}/${TARBALL}" -C /usr/local
    ${SUDO} ln -sf "/usr/local/node-v${NODE_VERSION_FALLBACK}-linux-${NODE_ARCH}/bin/node" /usr/local/bin/node
    ${SUDO} ln -sf "/usr/local/node-v${NODE_VERSION_FALLBACK}-linux-${NODE_ARCH}/bin/npm"  /usr/local/bin/npm
    ${SUDO} ln -sf "/usr/local/node-v${NODE_VERSION_FALLBACK}-linux-${NODE_ARCH}/bin/npx"  /usr/local/bin/npx
    rm -rf "${TMPD}"
    hash -r
    node_ok || fail "Node 安装后校验失败"
    info "npmmirror 安装成功：$(node -v)"
  fi
fi
hash -r

# ── 2. pnpm 9 ────────────────────────────────────────────────
if command -v pnpm >/dev/null 2>&1 && pnpm --version 2>/dev/null | grep -q '^9\.'; then
  info "pnpm 已就绪：$(pnpm --version)（跳过安装）"
else
  info "安装 pnpm@${PNPM_VERSION}"
  npm install -g "pnpm@${PNPM_VERSION}" --registry=https://registry.npmjs.org >/dev/null 2>&1 \
    || npm install -g "pnpm@${PNPM_VERSION}" --registry=https://mirrors.cloud.tencent.com/npm/ >/dev/null 2>&1 \
    || fail "pnpm 安装失败（npmjs 与腾讯镜像均不可达）"
fi
hash -r
command -v pnpm >/dev/null 2>&1 || fail "pnpm 不在 PATH 中（npm 全局 bin 目录未配置：export PATH=\$(npm prefix -g)/bin:\$PATH 后重试）"
info "pnpm $(pnpm --version) 就绪"

# ── 3. PostgreSQL ────────────────────────────────────────────
detect_server_ip() {
  # 优先公网网卡地址（不走外网探测，避免某些环境无出网）
  hostname -I 2>/dev/null | awk '{print $1}' || hostname -i 2>/dev/null || echo 127.0.0.1
}

ENV_FILE="${BACKEND_DIR}/.env"
DATABASE_URL_FROM_ENV=""
if [ -f "${ENV_FILE}" ]; then
  DATABASE_URL_FROM_ENV="$(grep -E '^DATABASE_URL=' "${ENV_FILE}" | head -1 | cut -d= -f2- | tr -d '"' || true)"
fi

LOCAL_PG_NEEDED=1
if [ "${SKIP_POSTGRES:-0}" = "1" ]; then
  LOCAL_PG_NEEDED=0
  info "SKIP_POSTGRES=1：跳过本机 Postgres（使用 .env 中 DATABASE_URL）"
elif [ -n "${DATABASE_URL_FROM_ENV}" ] && ! echo "${DATABASE_URL_FROM_ENV}" | grep -qE '@(localhost|127\.0\.0\.1)'; then
  LOCAL_PG_NEEDED=0
  info ".env 指向远端数据库，跳过本机 Postgres 安装"
fi

if [ "${LOCAL_PG_NEEDED}" = "1" ]; then
  info "安装/启动 PostgreSQL"
  if ! command -v psql >/dev/null 2>&1; then
    ${SUDO} apt-get install -y -qq postgresql postgresql-contrib >/dev/null
  fi
  ${SUDO} systemctl enable --now postgresql >/dev/null 2>&1 || true

  # 若 .env 已有本地 DATABASE_URL，沿用其中的用户/密码/库名，保证一致
  PG_PASSWORD="${PG_PASSWORD:-}"
  if [ -n "${DATABASE_URL_FROM_ENV}" ] && echo "${DATABASE_URL_FROM_ENV}" | grep -qE '@(localhost|127\.0\.0\.1)'; then
    PG_USER="$(  echo "${DATABASE_URL_FROM_ENV}" | sed -E 's#postgresql://([^:]+):.*#\1#')"
    PG_PASSWORD="$(echo "${DATABASE_URL_FROM_ENV}" | sed -E 's#postgresql://[^:]+:([^@]+)@.*#\1#')"
    PG_DB="$(    echo "${DATABASE_URL_FROM_ENV}" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
    info "沿用 .env 中的本地库配置（用户 ${PG_USER} / 库 ${PG_DB}）"
  fi
  if [ -z "${PG_PASSWORD}" ]; then
    PG_PASSWORD="$(tr -dc 'a-zA-Z0-9' </dev/urandom | head -c 24)"
  fi

  if ${SUDO} -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${PG_USER}'" | grep -q 1; then
    info "Postgres 用户 ${PG_USER} 已存在，重置密码以对齐配置"
    ${SUDO} -u postgres psql -qc "ALTER USER \"${PG_USER}\" WITH PASSWORD '${PG_PASSWORD}';" >/dev/null
  else
    ${SUDO} -u postgres psql -qc "CREATE USER \"${PG_USER}\" WITH PASSWORD '${PG_PASSWORD}';" >/dev/null
  fi
  if ! ${SUDO} -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" | grep -q 1; then
    ${SUDO} -u postgres psql -qc "CREATE DATABASE \"${PG_DB}\" OWNER \"${PG_USER}\";" >/dev/null
  fi
  DATABASE_URL_FROM_ENV="postgresql://${PG_USER}:${PG_PASSWORD}@localhost:5432/${PG_DB}"
  info "Postgres 就绪（用户 ${PG_USER} / 库 ${PG_DB}）"
fi

# ── 4. 依赖安装 ──────────────────────────────────────────────
info "安装项目依赖（pnpm install，仓库 .npmrc 已配置腾讯镜像）"
cd "${BACKEND_DIR}"
pnpm install --prefer-offline >/dev/null || pnpm install
info "依赖安装完成"

# ── 5. .env 生成/校对 ────────────────────────────────────────
SERVER_IP="$(detect_server_ip)"
if [ ! -f "${ENV_FILE}" ]; then
  info "生成 .env（API_BASE_URL=http://${SERVER_IP}:${PORT}）"
  cp "${BACKEND_DIR}/.env.example" "${ENV_FILE}"
  [ -n "${DATABASE_URL_FROM_ENV}" ] && sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL_FROM_ENV}|" "${ENV_FILE}"
  sed -i "s|^PORT=.*|PORT=${PORT}|" "${ENV_FILE}"
  sed -i "s|^API_BASE_URL=.*|API_BASE_URL=http://${SERVER_IP}:${PORT}|" "${ENV_FILE}"
else
  info ".env 已存在，保持不动（如需重置：rm ${ENV_FILE} 后重跑）"
fi

# ── 6. 建表 ──────────────────────────────────────────────────
info "推送数据库 schema（pnpm db:push）"
pnpm db:push || { warn "db:push 失败，请检查 DATABASE_URL（${ENV_FILE}）"; exit 1; }
info "数据库 schema 就绪"

# ── 7. systemd 常驻服务 ──────────────────────────────────────
if [ "${SKIP_SYSTEMD:-0}" = "1" ]; then
  warn "SKIP_SYSTEMD=1：不注册服务。手动运行： cd ${BACKEND_DIR} && pnpm start:api（另开终端 pnpm start:indexer）"
else
  info "注册 systemd 服务 proofnote-api / proofnote-indexer"
  RUN_USER="$(id -un)"
  NODE_BIN_DIR="$(dirname "$(command -v node)")"
  PNPM_BIN="$(command -v pnpm)"

  ${SUDO} tee /etc/systemd/system/proofnote-api.service >/dev/null <<EOF
[Unit]
Description=ProofNote API (Fastify on Monad testnet)
After=network.target postgresql.service

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${BACKEND_DIR}
Environment=PATH=${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
ExecStart=${PNPM_BIN} start:api
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  ${SUDO} tee /etc/systemd/system/proofnote-indexer.service >/dev/null <<EOF
[Unit]
Description=ProofNote Indexer (Monad event subscriber)
After=network.target proofnote-api.service

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${BACKEND_DIR}
Environment=PATH=${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
ExecStart=${PNPM_BIN} start:indexer
# MOCK_CHAIN 模式下 indexer 会正常退出（code 0），on-failure 避免无意义重启；
# 回填合约地址后它会常驻轮询
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

  ${SUDO} systemctl daemon-reload
  ${SUDO} systemctl enable --now proofnote-api.service >/dev/null 2>&1
  ${SUDO} systemctl enable --now proofnote-indexer.service >/dev/null 2>&1
  info "服务已启动（开机自启）"
fi

# ── 8. 健康检查 ──────────────────────────────────────────────
info "健康检查 http://127.0.0.1:${PORT}/healthz"
HEALTHY=0
for i in $(seq 1 20); do
  if curl -fs --connect-timeout 2 "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then HEALTHY=1; break; fi
  sleep 1
done
if [ "${HEALTHY}" = "1" ]; then
  info "healthz OK ✔  API 已在 http://${SERVER_IP}:${PORT} 提供服务"
else
  warn "healthz 未通过——查看日志：journalctl -u proofnote-api -n 50 --no-pager"
fi

# ── 9. 摘要 ──────────────────────────────────────────────────
cat <<EOF

============================================================
 ProofNote 后端环境就绪
============================================================
 项目目录     ${BACKEND_DIR}
 API 地址     http://${SERVER_IP}:${PORT}         （/api/v1 前缀）
 配置文件     ${ENV_FILE}   （合约地址回填后重启生效）
 数据库       ${DATABASE_URL_FROM_ENV:-<使用 .env 中 DATABASE_URL>}

 常用命令：
   systemctl status  proofnote-api  proofnote-indexer
   journalctl -u proofnote-api -f                 # 看 API 日志
   sudo systemctl restart proofnote-api           # 改 .env 后重启

 下一步：
   1) 云安全组/防火墙放行 TCP ${PORT}（API 对外）与 5432 不必开放
   2) 部署合约（contracts/README.md），把 6 个地址填入 .env 的 CONTRACT_*
   3) sudo systemctl restart proofnote-api proofnote-indexer
      → 自动退出 MOCK_CHAIN，Indexer 开始订阅链上事件
   4) 浏览器验证：curl http://127.0.0.1:${PORT}/api/v1/config
============================================================
EOF
