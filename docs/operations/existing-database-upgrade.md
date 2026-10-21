# 现有数据库的一次性升级

应用启动和请求只初始化新库，不补列或清理历史授权。已有部署需要保留数据时，暂停写入后单独使用本工具，不必恢复历史 Drizzle 迁移或清空数据库。

## 适用范围

`scripts/existing-database-upgrade.mjs` 只处理最近完整业务结构的两项已知差异：补充缺失的 `users.session_version INTEGER NOT NULL DEFAULT 0`，以及清理尚未完成 `role_isolation_v1` 的旧演示自动角色。

工具根据当前 `db/schema.ts` 检查必要业务表、列、类型、非空和主键属性。除了 `session_version`，其他当前业务表列缺失时直接拒绝，不猜测更早版本的升级步骤。自定义表、额外列、D1 元数据、业务内容和站点设置均保留，不修改机构名称、地区或历史时间戳。

角色清理必须同时命中自建机构 ID、同一账号的管理员授权和旧欢迎通知三个指纹；审计中 `member.created` 或 `invitation.accepted` 明确授予的角色保留，没有这些指纹的普通多角色账号也保留。已有 `role_isolation_v1` 标记时，不再清理后续重新授予的角色。如果旧欢迎通知已经删除，工具无法可靠区分自动授权和合法授权，应人工逐账号核对，不能扩大删除范围。

使用仓库现有 Node.js（`>=22.13.0`）和正常 `npm ci` 安装的开发依赖，无需新增包。以下路径和数据库名需要替换。

## Node / Docker 的 SQLite

工具在包含开发依赖的仓库中执行，生产 Docker 镜像不包含它。Docker 部署应先停止容器，再将下面的数据库路径替换为数据卷的实际宿主路径，使用独立运维环境处理该文件。

默认只读预览，输出 JSON 候选授权，不修改数据库，也不创建缺失文件：

```powershell
node scripts/existing-database-upgrade.mjs --database /data/huawen-zhixing.db
```

确认 `legacyRoles` 预览符合预期，暂停应用或容器后显式执行：

```powershell
node scripts/existing-database-upgrade.mjs --database /data/huawen-zhixing.db --apply --backup /backups/huawen-before-upgrade.sqlite
```

`--apply` 先以 SQLite `VACUUM INTO` 生成包含已提交 WAL 内容的一致性备份，再在一个 `BEGIN IMMEDIATE` 事务中重新检查结构、补列、清理授权、写审计及标记。备份目标必须不存在；省略 `--backup` 时在数据库旁生成带时间和随机 ID 的新备份。备份包含业务和账号数据，应保存在受控目录。

任何 SQL 失败都会回滚补列、授权、审计和标记，备份保留。成功后再次检查应显示 `needsUpgrade: false`；重复 `--apply` 不写入、不新增备份，也不清理重新授权。随后启动应用并检查登录与角色。若需回退，在应用停止时恢复完整备份并处理同名 WAL/SHM，避免混用恢复前后的状态。

## Cloudflare D1

生成 SQL 不连接 Cloudflare，不读取令牌，不执行远程写入。先暂停应用写入，通过已认证的 Wrangler 导出完整备份，再只读核对列状态：

```powershell
npx wrangler d1 export DB --remote --output=before-upgrade.sql
npx wrangler d1 execute DB --remote --command="PRAGMA table_info(users)" --json
```

缺少 `session_version` 时选择 `missing`，已有时选择 `present`，不要凭版本猜测：

```powershell
node scripts/existing-database-upgrade.mjs --d1-sql --session-version missing --output existing-database-upgrade.sql
```

`--output` 创建 UTF-8 无 BOM 文件，拒绝覆盖已有文件，避免不同 PowerShell 版本重定向编码差异。省略它则只将 SQL 打印到终端。先审查生成的 SQL，再导入**整个文件**：

```powershell
npx wrangler d1 execute DB --remote --file=existing-database-upgrade.sql
```

文件前置断言检查支持的业务结构及列状态；不匹配时整批失败。文件没有 `BEGIN` / `COMMIT`，不能拆成独立 `--command` 请求。安装的 Wrangler 本地 `--file` 使用 D1 `batch()`，远程 `--file` 走 D1 `/import`，导入失败恢复原状态。依据是 Cloudflare 对[文件导入原子性](https://blog.cloudflare.com/building-d1-a-global-database)的说明、[导入文档](https://developers.cloudflare.com/d1/best-practices/import-export-data/)以及仓库安装的 Wrangler 执行实现。

成功后检查列、实际角色、审计记录和 `app_settings` 的 `role_isolation_v1` / `existing_database_upgrade_v1`，再恢复应用。若要重跑，重新核对列并生成 `present` 方案，不要重放包含 `ADD COLUMN` 的旧 `missing` 文件。回退使用事先保存的 D1 恢复点或完整备份，不猜测局部反向删列。

自动测试仅使用虚构 SQLite/D1 数据，不会连接或修改线上数据库。
