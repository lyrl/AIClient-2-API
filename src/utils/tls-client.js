/**
 * TLS Client Wrapper
 * 
 * 使用 bogdanfinn/tls-client 共享库 (通过 koffi FFI) 实现完整的 Chrome TLS 指纹伪装。
 * 等效于 Go 的 uTLS，覆盖 JA3/JA4 指纹、TLS 扩展顺序、GREASE、HTTP/2 SETTINGS 等。
 * 
 * 若共享库不可用，自动降级为原生 HTTPS（由调用方处理 fallback）。
 * 
 * 共享库下载：https://github.com/bogdanfinn/tls-client/releases
 * 放置位置：项目根目录 /lib/tls-client.so (Linux) 或 tls-client.dll (Windows)
 */

import { Readable } from 'stream';
import { join } from 'path';
import { existsSync, readdirSync } from 'fs';
import logger from './logger.js';

let lib = null;
let _available = false;
let _initDone = false;

// 共享库搜索路径
const SEARCH_DIRS = [
    join(process.cwd(), 'lib'),
    '/usr/local/lib',
    '/usr/lib',
    process.cwd(),
];

/**
 * 根据平台返回共享库文件名候选列表
 */
function getLibNames() {
    const p = process.platform;
    const a = process.arch;
    const names = [];

    if (p === 'linux') {
        // alpine (musl) vs ubuntu (glibc)，匹配带版本号和不带版本号的文件名
        names.push(
            'tls-client-linux-alpine-amd64.so',
            'tls-client-linux-ubuntu-amd64.so',
            `tls-client-linux-${a === 'arm64' ? 'arm64' : 'amd64'}.so`,
            'tls-client.so',
        );
    } else if (p === 'darwin') {
        names.push(
            `tls-client-darwin-${a === 'arm64' ? 'arm64' : 'amd64'}.dylib`,
            'tls-client.dylib',
        );
    } else if (p === 'win32') {
        names.push(
            'tls-client-windows-64.dll',
            'tls-client-64.dll',
            'tls-client.dll',
        );
    }
    return names;
}

/**
 * 在搜索路径中查找共享库
 */
function findLib() {
    const candidates = getLibNames();
    for (const dir of SEARCH_DIRS) {
        if (!existsSync(dir)) continue;
        // 先精确匹配已知文件名
        for (const name of candidates) {
            const fullPath = join(dir, name);
            if (existsSync(fullPath)) return fullPath;
        }
        // 模糊匹配带版本号的文件名 (如 tls-client-windows-64-1.14.0.dll)
        try {
            const files = readdirSync(dir);
            for (const file of files) {
                if (file.startsWith('tls-client') && (file.endsWith('.so') || file.endsWith('.dll') || file.endsWith('.dylib'))) {
                    return join(dir, file);
                }
            }
        } catch {}
    }
    return null;
}

/**
 * 初始化 tls-client（仅执行一次）
 * @returns {Promise<boolean>} 是否成功加载
 */
export async function initTlsClient() {
    if (_initDone) return _available;
    _initDone = true;

    try {
        const koffi = (await import('koffi')).default;
        const libPath = findLib();
        if (!libPath) {
            logger.info('[TLS-Client] Shared library not found in search paths. Falling back to native HTTPS.');
            logger.info('[TLS-Client] To enable: download from https://github.com/bogdanfinn/tls-client/releases and place in ./lib/');
            return false;
        }

        const loaded = koffi.load(libPath);
        lib = {
            request: loaded.func('request', 'str', ['str']),
            freeMemory: loaded.func('freeMemory', 'void', ['str']),
            destroySession: loaded.func('destroySession', 'str', ['str']),
            destroyAll: loaded.func('destroyAll', 'void', []),
        };

        _available = true;
        logger.info(`[TLS-Client] Loaded successfully: ${libPath}`);
        return true;
    } catch (error) {
        logger.info(`[TLS-Client] Init failed: ${error.message}. Falling back to native HTTPS.`);
        return false;
    }
}

/**
 * 是否可用
 */
export function isTlsClientAvailable() {
    return _available;
}

/**
 * 使用 Chrome TLS 指纹发送 HTTP 请求
 * 
 * @param {string} url - 请求 URL
 * @param {Object} options
 * @param {string} [options.method='POST'] - HTTP 方法
 * @param {Object} [options.headers={}] - 请求头
 * @param {string|Object} [options.body] - 请求体
 * @param {string} [options.profile='chrome_131'] - TLS 客户端标识符
 * @param {number} [options.timeout=30] - 超时秒数
 * @param {string} [options.proxy=''] - 代理 URL
 * @param {string} [options.sessionId] - 会话 ID（用于 cookie 持久化）
 * @returns {Promise<{status: number, headers: Object, data: string}>}
 */
export async function tlsRequest(url, options = {}) {
    if (!_available) throw new Error('[TLS-Client] Not loaded');

    const sessionId = options.sessionId || `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const headers = options.headers || {};

    const payload = JSON.stringify({
        tlsClientIdentifier: options.profile || 'chrome_131',
        sessionId: sessionId,
        requestUrl: url,
        requestMethod: (options.method || 'POST').toUpperCase(),
        requestBody: options.body != null
            ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
            : '',
        headers: headers,
        headerOrder: Object.keys(headers),
        followRedirects: options.followRedirects ?? false,
        timeoutSeconds: options.timeout || 30,
        proxyUrl: options.proxy || '',
        insecureSkipVerify: false,
        withoutCookieJar: true,
        forceHttp1: false,
        catchPanics: true,
        withRandomTLSExtensionOrder: true,
    });

    // 异步 FFI 调用，避免阻塞 Node.js 事件循环
    const raw = await new Promise((resolve, reject) => {
        lib.request.async(payload, (err, res) => {
            if (err) reject(new Error(`[TLS-Client] FFI call failed: ${err.message || err}`));
            else resolve(res);
        });
    });

    let resp;
    try {
        resp = JSON.parse(raw);
    } catch {
        throw new Error(`[TLS-Client] Invalid JSON response: ${raw?.substring(0, 200)}`);
    }

    // status=0 表示 tls-client 内部错误（非 HTTP 错误）
    if (resp.status === 0) {
        const err = new Error(resp.body || '[TLS-Client] Request failed');
        err.tlsClientError = true;
        throw err;
    }

    return {
        status: resp.status,
        headers: resp.headers || {},
        data: resp.body,
        cookies: resp.cookies || {},
    };
}

/**
 * 使用 Chrome TLS 指纹发送请求，返回 Readable Stream（用于 NDJSON/SSE 响应）
 * 
 * 注意：tls-client 会缓冲完整响应后才返回。此方法将缓冲的数据拆分为行，
 * 通过 Readable 流逐行输出，下游代码无需修改。
 * 代价是用户不会看到实时逐 token 输出，而是等待完整响应后一次性呈现。
 * 
 * @param {string} url - 请求 URL
 * @param {Object} options - 同 tlsRequest
 * @returns {Promise<{status: number, headers: Object, data: Readable}>}
 */
export async function tlsStreamRequest(url, options = {}) {
    const resp = await tlsRequest(url, {
        ...options,
        timeout: options.timeout || 120,
    });

    const body = resp.data || '';
    const lines = body.split('\n');
    let idx = 0;

    const stream = new Readable({
        read() {
            if (idx < lines.length) {
                this.push(lines[idx] + '\n');
                idx++;
            } else {
                this.push(null);
            }
        },
    });

    return {
        status: resp.status,
        headers: resp.headers,
        data: stream,
    };
}

/**
 * 销毁 tls-client 会话（释放资源）
 */
export async function destroyTlsSession(sessionId) {
    if (!_available || !sessionId) return;
    try {
        await new Promise((resolve) => {
            lib.destroySession.async(
                JSON.stringify({ sessionId }),
                () => resolve(),
            );
        });
    } catch {
        // 忽略销毁失败
    }
}
