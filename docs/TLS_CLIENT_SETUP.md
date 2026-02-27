# TLS-Client 共享库安装指南

基于 [bogdanfinn/tls-client](https://github.com/bogdanfinn/tls-client) v1.14.0，提供完整的 Chrome TLS 指纹伪装（JA3/JA4），用于绕过 Cloudflare 等 Bot 检测。

## 下载地址

| 平台 | 文件名 | 下载链接 |
|------|--------|----------|
| **Windows x64** | `tls-client-windows-64-1.14.0.dll` | [下载](https://github.com/bogdanfinn/tls-client/releases/download/v1.14.0/tls-client-windows-64-1.14.0.dll) |
| **Windows x86** | `tls-client-windows-32-1.14.0.dll` | [下载](https://github.com/bogdanfinn/tls-client/releases/download/v1.14.0/tls-client-windows-32-1.14.0.dll) |
| **Linux x64 (Alpine/musl)** | `tls-client-linux-alpine-amd64-1.14.0.so` | [下载](https://github.com/bogdanfinn/tls-client/releases/download/v1.14.0/tls-client-linux-alpine-amd64-1.14.0.so) |
| **Linux x64 (Ubuntu/glibc)** | `tls-client-linux-ubuntu-amd64-1.14.0.so` | [下载](https://github.com/bogdanfinn/tls-client/releases/download/v1.14.0/tls-client-linux-ubuntu-amd64-1.14.0.so) |
| **Linux ARM64** | `tls-client-linux-arm64-1.14.0.so` | [下载](https://github.com/bogdanfinn/tls-client/releases/download/v1.14.0/tls-client-linux-arm64-1.14.0.so) |
| **Linux ARMv7** | `tls-client-linux-armv7-1.14.0.so` | [下载](https://github.com/bogdanfinn/tls-client/releases/download/v1.14.0/tls-client-linux-armv7-1.14.0.so) |
| **macOS x64 (Intel)** | `tls-client-darwin-amd64-1.14.0.dylib` | [下载](https://github.com/bogdanfinn/tls-client/releases/download/v1.14.0/tls-client-darwin-amd64-1.14.0.dylib) |
| **macOS ARM64 (Apple Silicon)** | `tls-client-darwin-arm64-1.14.0.dylib` | [下载](https://github.com/bogdanfinn/tls-client/releases/download/v1.14.0/tls-client-darwin-arm64-1.14.0.dylib) |

> 所有版本的 Release 页面：https://github.com/bogdanfinn/tls-client/releases

## 使用方法

### 1. 本地开发

将下载的共享库文件放入项目根目录的 `lib/` 文件夹：

```
AIClient2API/
├── lib/
│   └── tls-client-windows-64-1.14.0.dll   # Windows
│   └── tls-client-darwin-arm64-1.14.0.dylib # macOS Apple Silicon
│   └── tls-client-linux-alpine-amd64-1.14.0.so # Linux Alpine
├── src/
├── package.json
└── ...
```

安装 FFI 依赖：

```bash
npm install koffi
# 或
pnpm install koffi
```

启动应用后，日志中会显示加载状态：

```
[TLS-Client] Loaded successfully: /path/to/lib/tls-client-xxx.dll
[Grok] Using tls-client (profile: chrome_131) for Chrome TLS fingerprinting
```

### 2. Docker 部署

Dockerfile 中已包含自动下载步骤（Alpine x64），无需手动操作：

```dockerfile
RUN mkdir -p /app/lib && TLS_CLIENT_VERSION="1.14.0" && \
    curl -fsSL "https://github.com/bogdanfinn/tls-client/releases/download/v${TLS_CLIENT_VERSION}/tls-client-linux-alpine-amd64-${TLS_CLIENT_VERSION}.so" \
    -o /app/lib/tls-client-linux-alpine-amd64.so
```

如需 ARM64 部署，修改 URL 中的 `alpine-amd64` 为 `arm64`。

### 3. 自动降级

如果共享库不存在或加载失败，应用会自动降级为原生 HTTPS（使用 Chrome cipher suite 配置），不会影响正常运行：

```
[TLS-Client] Shared library not found in search paths. Falling back to native HTTPS.
[Grok] Using native HTTPS with Chrome cipher suite configuration (partial fingerprint)
```

## 搜索路径

程序会按以下顺序搜索共享库：

1. `{项目根目录}/lib/`
2. `/usr/local/lib/`
3. `/usr/lib/`
4. `{项目根目录}/`

支持精确文件名和带版本号的文件名（如 `tls-client-windows-64-1.14.0.dll`）。

## 配置项

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `GROK_TLS_PROFILE` | `chrome_131` | TLS 客户端标识符，可选值见下方 |

### 支持的 TLS Profile

- `chrome_131`, `chrome_133`, `chrome_136`, `chrome_144`
- `firefox_133`
- `safari_18_0`
- 更多 profile 见 [tls-client profiles 文档](https://bogdanfinn.gitbook.io/open-source-oasis/)

## 原理

| 层级 | tls-client (完整) | 原生 HTTPS (降级) |
|------|:---:|:---:|
| TLS Cipher Suites 顺序 | ✅ | ✅ |
| TLS 扩展顺序 | ✅ | ❌ |
| GREASE 值 | ✅ | ❌ |
| JA3/JA4 指纹 | ✅ 完全匹配 Chrome | ❌ 部分匹配 |
| ALPN 协商 (h2) | ✅ | ❌ (仅 http/1.1) |
| HTTP/2 SETTINGS 帧 | ✅ | ❌ |
| 签名算法 | ✅ | ✅ |
| EC 曲线 | ✅ | ✅ |
| HTTP Header 伪装 | ✅ | ✅ |
