# 高德受控在线冒烟

该命令只验证：

```text
本地服务端 Adapter → 高德 Web Service
```

它不验证 Cloudflare Worker，不属于普通测试集，也不会写入数据库或保存高德响应正文。

## 安全配置 Key

不要把 Key 写入命令行参数、项目文件、Git 配置或聊天。PowerShell 可使用交互式安全输入临时设置当前进程环境变量：

```powershell
$secret = Read-Host "AMAP Web Service Key" -AsSecureString
$env:AMAP_WEB_SERVICE_KEY = [System.Net.NetworkCredential]::new("", $secret).Password
pnpm run smoke:amap
Remove-Item Env:AMAP_WEB_SERVICE_KEY
$secret = $null
```

关闭终端也会清除该临时环境变量。

## 行为边界

- 缺少 `AMAP_WEB_SERVICE_KEY` 时返回 `skipped`，请求数为 0；
- 使用固定公开地点“杭州黄龙体育中心”；
- 只发送一次地理编码、一次步行路线和一次骑行路线请求；
- 自动重试设置为 0 次；
- 每条路线只允许一个物理路段；
- 输出不包含 Key、坐标、原始响应、请求 URL 或第三方错误正文；
- 失败只输出稳定错误 code 和已发生的请求数量。

成功摘要只包含地点是否解析、路线几何点数、距离、时间和坐标系检查结果。
