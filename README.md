# INFPLife · 精灵看板 🧚

日常习惯追踪 + 精灵收集 + 经验值等级系统

## 功能

- ✅ 每日习惯打卡
- 💧 喝水追踪
- ⚖️ 体重记录
- 🧚 精灵图鉴（像素风，拓麻歌子式喂养）
- 🪙 金币商店 + 喂食升级
- 📊 EXP 经验值 + 称号系统（每10级一个称号）
- 🌙 深色模式

## 本地运行

```bash
cd habit-dashboard
python3 -m http.server 8080
```

## 安全模型

- 网页使用 Supabase 邮箱密码登录；公开的 publishable key 只负责标识项目。
- `user_state` 启用并强制执行 RLS，未登录用户没有任何表权限。
- 登录用户只能读取自己的状态行，更新必须经过带版本检查的 `save_user_state` RPC。
- 浏览器没有 `DELETE` 权限；设置中的“重置”会写入空状态。
- `service_role`、数据库密码、账号密码和 Apple 快捷指令密钥不得放入仓库或网页。

数据库变更保存在 `supabase/migrations/`。关联远程项目后使用 Supabase CLI 审查并推送：

```bash
supabase link --project-ref xqvhcncxnwhokhfpyyjl
supabase db push --dry-run
supabase db push
supabase config push
```

`db push` 只应用数据库迁移；关闭公开注册、站点 URL 和邮箱验证等 Auth 配置由
`config push` 单独发布。发布后再次运行 `supabase config push`，应显示 Remote Auth
config is up to date。

## Apple Watch 快捷指令

快捷指令调用以下端点，不再打开包含数据的网页 URL：

```text
POST https://xqvhcncxnwhokhfpyyjl.supabase.co/functions/v1/shortcut-ingest
```

请求头：

```text
Content-Type: application/json
x-shortcut-secret: <仅保存在快捷指令和 Supabase Secret 中的随机密钥>
```

运动分钟请求正文：

```json
{
  "event_id": "<快捷指令每次生成的新 UUID>",
  "type": "exercise",
  "value": 35,
  "occurred_on": "2026-07-22"
}
```

`value` 应替换为“今天运动分钟”的求和结果，日期由“当前日期”格式化为 `yyyy-MM-dd`。函数也支持 `water`（1–20 杯）和 `weight`（20–400 kg）。同一个 `event_id` 重试不会重复计数。

部署函数前，在本机生成随机密钥并通过 CLI 设置，不要把输出提交到 Git：

```bash
openssl rand -base64 32
supabase secrets set OWNER_USER_ID='<Auth 用户 UUID>' SHORTCUT_SECRET='<随机密钥>'
supabase functions deploy shortcut-ingest --no-verify-jwt
```
