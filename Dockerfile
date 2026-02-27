# 使用官方Node.js运行时作为基础镜像
# 选择20-alpine版本以满足undici包的要求（需要Node.js >=20.18.1）
FROM node:20-alpine

# 设置标签
LABEL maintainer="AIClient2API Team"
LABEL description="Docker image for AIClient2API server"

# 安装必要的系统工具（tar 用于更新功能，git 用于版本检查）
RUN apk add --no-cache tar git curl

# 设置工作目录
WORKDIR /app

# [可选] 下载 tls-client 共享库用于完整 Chrome TLS 指纹伪装
# 如不需要可注释掉，应用会自动降级为原生 HTTPS
RUN mkdir -p /app/lib && TLS_CLIENT_VERSION="1.14.0" && curl -fsSL "https://github.com/bogdanfinn/tls-client/releases/download/v${TLS_CLIENT_VERSION}/tls-client-linux-alpine-amd64-${TLS_CLIENT_VERSION}.so" -o /app/lib/tls-client-linux-alpine-amd64.so || echo "TLS-Client download failed, using native HTTPS fallback"

# 复制package.json和package-lock.json（如果存在）
COPY package*.json ./

# 安装依赖
# 使用--production标志只安装生产依赖，减小镜像大小
# 使用--omit=dev来排除开发依赖
RUN npm install

# 复制源代码
COPY . .

USER root

# 创建目录用于存储日志和系统提示文件
RUN mkdir -p /app/logs

# 暴露端口
EXPOSE 3000 8085 8086 19876-19880

# 添加健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js || exit 1

# 设置启动命令
# 使用默认配置启动服务器，支持通过环境变量配置
# 通过环境变量传递参数，例如：docker run -e ARGS="--api-key mykey --port 8080" ...
# LD_PRELOAD: 解决 Alpine (musl) 下 Go 共享库 dlopen TLS 重定位错误
# 在进程启动时预加载 .so，绕过 koffi dlopen() 的 musl initial-exec TLS 限制
ENV LD_PRELOAD=/app/lib/tls-client-linux-alpine-amd64.so

CMD ["sh", "-c", "node src/core/master.js $ARGS"]