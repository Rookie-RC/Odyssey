# 部署成网站（云端模式）

> Odyssey 的主要形态是手机 App，数据留在手机上（见 [ROADMAP.md](ROADMAP.md)）。云端模式保留为备选形态，网页版的定位还没定；本文只说明怎么把它部署起来。

同一个 `atlas` 程序有两种运行方式：

| | 本地模式（默认） | 云端模式 `-mode cloud` |
|---|---|---|
| 用户 | 设备的主人（手机 App；电脑上用于开发） | 任意多人，每人一个账号（邮箱 + 密码） |
| 数据 | `atlas-data/` 一个目录 | `<data>/users/<账号id>/`，每个账号一个完整的 atlas-data 目录 |
| 访问 | 127.0.0.1 | 公网，通过 HTTPS 反向代理 |

前端、API、导入导出、备份逻辑两种模式完全共用；云端模式只是在外面加了账号、会话、按账号分流和公网访问规则（`apps/runtime/internal/cloud`）。

---

## 1. 准备一台服务器

- **配置**：1 核 1–2 GB 内存、20 GB 以上磁盘就够起步（照片是主要占用：默认每人 500 MB 配额）。
- **地区怎么选**：用户是在海外的留学生，偶尔回国。
  - **香港 / 新加坡**：国内和欧美都能访问，速度折中，**不需要 ICP 备案**。起步推荐。
  - **欧洲 / 美国**：海外用户最快，国内访问可能较慢或不稳定。
  - **中国大陆**：国内最快，但域名必须先做 **ICP 备案** 才能用 80/443 端口提供网站。只有以后做**微信小程序**时才真正需要（小程序要求请求的服务器域名是 HTTPS 且已备案，小程序本身也要备案）。到那时再加一套大陆部署即可，API 是同一套。
- **域名**：买一个域名，把 A/AAAA 记录指向服务器 IP。
- 系统以 Ubuntu/Debian 为例。

## 2. 构建

在开发机上（需要 Node.js + pnpm + Go）：

```bash
./scripts/build.sh          # 前端静态导出 → 嵌入 Go 程序 → bin/atlas（本机平台）
```

如果开发机不是 Linux x86-64，再交叉编译一个服务器用的版本（`build.sh` 已经把前端嵌进去了）：

```bash
cd apps/runtime
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" \
  -o ../../bin/atlas-linux-amd64 ./cmd/atlas
```

ARM 服务器把 `GOARCH` 换成 `arm64`。产物是一个不依赖任何运行库的单文件。

## 3. 安装为系统服务

```bash
scp bin/atlas-linux-amd64 server:/tmp/atlas
ssh server
sudo useradd --system --no-create-home --shell /usr/sbin/nologin atlas
sudo install -D -m 0755 /tmp/atlas /opt/atlas/atlas
sudo cp atlas.service /etc/systemd/system/atlas.service   # 仓库里的 deploy/atlas.service
# 编辑 -public-origin，改成你的域名
sudo systemctl daemon-reload
sudo systemctl enable --now atlas
journalctl -u atlas -f
```

示例单元文件见 [`deploy/atlas.service`](../deploy/atlas.service)：数据放在 `/var/lib/atlas`（systemd 自动创建，只有 atlas 用户可读写），程序只监听 `127.0.0.1:4317`，由 Caddy 对外提供 HTTPS。

### 启动参数

| 参数 | 说明 |
|---|---|
| `-mode cloud` | 云端模式 |
| `-data /var/lib/atlas` | 所有账号数据的根目录（必填） |
| `-public-origin https://atlas.example.com` | 网站对外的地址，逗号分隔可写多个。决定接受哪些 Host / Origin、Cookie 是否带 `Secure` |
| `-trust-proxy` | 从本机反向代理读取真实客户端 IP 和 https（限流和 Cookie 需要），只信任来自 127.0.0.1 的连接 |
| `-allow-signup=false` | 关闭公开注册（内测阶段可用） |
| `-user-quota-mb 500` | 每个账号的存储上限（照片 + 数据 + 备份），0 为不限 |
| `-host` / `-port` | 监听地址，默认 `127.0.0.1:4317`；云端模式下端口被占用会直接报错，不会换端口 |

### 环境变量

- `ATLAS_SESSION_SECRET`：会话签名密钥（至少 32 个字符）。不设置时首次启动自动生成到 `<data>/secret.key`（权限 0600）。**更换密钥会让所有人掉线。**
- `YUATLAS_DATA`：等同 `-data`。

## 4. HTTPS：Caddy 反向代理

```bash
sudo apt install caddy
sudo cp Caddyfile /etc/caddy/Caddyfile     # 仓库里的 deploy/Caddyfile，改成你的域名
sudo systemctl reload caddy
```

Caddy 会自动申请并续期证书。示例见 [`deploy/Caddyfile`](../deploy/Caddyfile)（开启压缩、HSTS，上传上限 520 MB 以容纳 `.atlas` 导入）。

## 5. 数据目录与备份

```text
/var/lib/atlas/
├── users.json          账号列表（邮箱、argon2id 密码哈希、会话版本）
├── secret.key          会话签名密钥
├── users/<id>/         每个账号一个完整的 atlas-data：data/*.json、media/、backups/
└── cache/thumbs/<id>/  缩略图缓存，可随时删除，不需要备份
```

**一定要做异地备份**。最简单的每日备份（root 的 crontab）：

```bash
0 4 * * * tar --exclude=cache -czf /root/backups/atlas-$(date +\%F).tar.gz -C /var/lib atlas && find /root/backups -name 'atlas-*.tar.gz' -mtime +14 -delete
```

再用 `rclone` / `restic` 同步到对象存储（Cloudflare R2、Backblaze B2、腾讯云 COS 等）。所有 JSON 都是原子写入，运行中直接打包是安全的。

每个用户也可以随时在「管理地图集 → 导入 / 导出」下载自己的 `.atlas` 文件。

## 6. 本地试运行

```bash
./bin/atlas -mode cloud -data /tmp/atlas-cloud -port 4317 -public-origin http://127.0.0.1:4317
# 浏览器打开 http://127.0.0.1:4317 → 注册 → 进入自己的空地图集
```

开发前端时：`go run ./cmd/atlas -mode cloud -data /tmp/atlas-cloud -public-origin http://localhost:3000`，另开一个终端 `pnpm dev`，访问 `http://localhost:3000`。

## 7. 安全设计（已实现）

- 密码用 **argon2id**（OWASP 推荐参数）哈希；登录失败时无论邮箱是否存在，耗时和提示都一样。
- 会话是 HMAC-SHA256 签名的 Cookie（30 天，`HttpOnly`、`SameSite=Lax`，https 下 `Secure`），活跃使用会自动续期；修改密码、「退出所有设备」、注销账号会让旧会话全部失效。
- 数据接口 `/api/*` 和照片 `/media/*` 的 URL 里**没有账号 id**，完全由会话决定访问谁的数据，一个账号无法拿到另一个账号的任何内容（有自动化测试覆盖）。照片响应标记为 `private`，不会被 CDN 等共享缓存保存。
- 只接受配置过的域名（Host 检查）；跨站写请求一律拒绝（Origin 检查 + SameSite Cookie）；附带 `X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy` 安全头。
- 限流：登录（每 IP 15 分钟 20 次、每邮箱 15 分钟 10 次）、注册（每 IP 每小时 10 次）、地点搜索（每账号每分钟 60 次）。JSON 请求体上限 1 MB，单张照片 25 MB，导入 512 MB，且都受账号配额约束。
- 注销账号会等待该账号进行中的请求结束，然后删除账号记录、整个数据目录和缩略图缓存。

## 8. 正式上线前必须处理的事

这些问题本地单机使用时无所谓，变成公开网站后就必须解决：

1. **底图（Carto）的使用条款**：现在的地图底图来自 `basemaps.cartocdn.com`，Carto 的免费底图只允许非商业使用，并有访问量上限（以 Carto 当前条款为准）。公开上线前应换成有明确额度的服务：MapTiler（有免费额度，需要 key）、Stadia Maps、OpenFreeMap（免费、无需 key），或者自托管 Protomaps（一个 PMTiles 文件放在对象存储上）。`apps/web/src/lib/map-style.ts` 的主题适配是按 Carto 样式的图层写的，换底图需要改这里。另外 cartocdn 和地形瓦片（AWS S3）在中国大陆访问可能很慢。
2. **地点搜索（Photon）的公平使用**：`photon.komoot.io` 是公益服务，不适合承载正式产品的流量。服务端已经做了缓存和每账号限流，但上线后应换成 MapTiler Geocoding（`runtime-config.json` 里已预留 `mapTilerApiKey`，但对应的 provider 还没实现）或自托管 Photon。
3. **忘记密码**：目前没有找回密码功能（需要发邮件的能力：SMTP 或邮件服务商 API），也没有邮箱验证。公开注册前要补上。
4. **隐私政策和用户协议**：收集了邮箱、照片和行程这类个人信息，需要写清楚存在哪里、谁能看到、如何导出和删除（导出和注销功能已经有了）。如果以后面向中国大陆用户提供服务（尤其是小程序），还要满足《个人信息保护法》等要求，届时建议咨询专业意见。
5. **监控**：至少配置磁盘空间告警和服务存活检查（例如定时请求 `/api/runtime`）。
6. **配额包含备份**：每次导入、恢复、新建地图集都会先在账号目录里生成一个 `.atlas` 备份，计入配额。用户可以在「导入 / 导出」里删除旧备份。
