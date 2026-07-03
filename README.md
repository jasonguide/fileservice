# FileService

一个极简的文件中转站 Web 服务，适用于 NAS 部署场景。在公司/外部电脑上传文件，回家后通过 NAS 访问和下载。

## 功能清单

| 功能 | 说明 |
|------|------|
| 文件列表 | 展示 Name / Last Modified / Size / Actions，支持点击表头排序 |
| 上传文件 | 小文件常规上传；大文件（>50MB）自动分片上传（10MB/片，3路并发） |
| 下载文件 | 支持 HTTP Range 断点续传 |
| 新建文件夹 | 创建任意层级目录 |
| 新建文件 | 创建空白文本文件 |
| 在线编辑 | 文本文件（.txt/.md/.json/.go/.py 等）支持在线编辑保存 |
| 删除 | 删除文件或文件夹（递归删除） |
| 搜索过滤 | 实时搜索当前目录下的文件 |
| 拖拽上传 | 直接将文件拖入页面即可上传 |
| 面包屑导航 | 快速跳转上级目录 |
| 移动端 | UI已适配移动端，手机使用更方便 |

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 后端 | Go 1.21（标准库） | 单二进制，零外部依赖，运行内存 < 20MB |
| 前端 | 原生 HTML / CSS / JS | 无构建步骤，无框架依赖 |
| 部署 | Docker + Alpine | 最终镜像约 15MB |

## 本地运行

### 前置要求

- Go 1.21+

### 步骤

```bash
# 1. 进入项目目录
cd fileservice

# 2. 直接启动 Web 服务（无需编译）
DATA_DIR=./data PORT=8010 go run .

# Windows PowerShell:
$env:DATA_DIR="./data"; $env:PORT="8010"; go run .

# Linux/Mac
DATA_DIR=./data PORT=8010 go run .
```

环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8010` | 指定服务运行端口 |
| `DATA_DIR` | `/data` | 指定文件存储目录 |


访问：

打开浏览器访问：`http://localhost:8010`


## Docker 部署

### 部署到服务器

有两种方式将项目部署到服务器（NAS），都无需宿主机安装 go 环境。

**方式一：上传源码到服务器构建（推荐，简单直接）**

```bash
# 1. 本地打包项目（排除不必要的文件）
tar -czf fileservice.tar.gz --exclude='.git' fileservice/

# 2. 上传到服务器
scp fileservice.tar.gz user@nas-ip:/opt/

# 3. SSH 登录服务器，解压
ssh user@nas-ip
cd /opt && tar -xzf fileservice.tar.gz

# 4. 进入目录，编辑 docker-compose.yml 修改卷映射路径
# 5. 构建并启动（见下方「一键启动」）
```

**方式二：本地构建镜像，推送到镜像仓库**

```bash
# 1. 本地构建镜像
docker build -t your-registry/fileservice:latest .

# 2. 推送到镜像仓库（Docker Hub / 私有仓库）
docker push your-registry/fileservice:latest

# 3. SSH 登录服务器，拉取镜像并运行
docker pull your-registry/fileservice:latest
docker run -d --name fileservice \
  -p 8010:8010 \
  -v /your/nas/path/files:/data \
  -e TZ=Asia/Shanghai \
  -e PORT=8010 \
  -e DATA_DIR=/data \
  --memory=200m \
  --restart=unless-stopped \
  your-registry/fileservice:latest
```

### 一键启动

1. 编辑 `docker-compose.yml`，修改卷映射路径为你的服务器实际路径。

```yaml
volumes:
  - /your/nas/path/files:/data    # ← 左侧改成服务器上的实际路径
```

2. 构建并启动：

```bash
docker compose up -d --build
```

3. 访问：`http://<NAS-IP>:8010`

### 常用命令

```bash
# 查看日志
docker compose logs -f

# 停止服务
docker compose down

# 重新构建（更新代码后）
docker compose up -d --build
```

### 配置说明

`docker-compose.yml` 关键配置：

```yaml
services:
  fileservice:
    build: .
    container_name: fileservice
    restart: unless-stopped
    ports:
      - "8010:8010"
    volumes:
      - /your/nas/path/files:/data    # 数据目录映射
    environment:
      - TZ=Asia/Shanghai              # 时区
      - PORT=8010
      - DATA_DIR=/data
    mem_limit: 200m                   # 内存限制 200MB
```

如需修改端口，同时改 `ports` 和 `PORT` 环境变量即可。

## 大文件上传说明

- 文件 **≤ 50MB**：使用常规 multipart 上传，单次请求完成
- 文件 **> 50MB**：自动启用分片上传
  - 分片大小：10MB
  - 并发上传：3 路并行
  - 流程：`初始化 → 分片上传 → 合并完成`
  - 服务端临时文件存于系统 `/tmp` 目录，合并完成后自动清理

## 项目结构

```
fileservice/
├── main.go              # 入口：路由注册、配置加载、静态文件嵌入
├── handlers.go          # API 处理器
├── utils.go             # 工具函数
├── go.mod               # Go 模块定义
├── static/
│   ├── index.html       # 页面
│   ├── style.css        # 样式
│   └── app.js           # 前端逻辑
├── Dockerfile           # 多阶段构建
├── docker-compose.yml   # 部署配置
└── .dockerignore
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/list?path=` | 列出目录内容 |
| POST | `/api/upload?path=` | 常规上传（multipart） |
| POST | `/api/upload/init` | 初始化分片上传 |
| POST | `/api/upload/chunk?uploadId=&chunkIndex=` | 上传单个分片 |
| POST | `/api/upload/complete` | 合并分片完成上传 |
| POST | `/api/upload/cancel` | 取消分片上传 |
| GET | `/api/download?path=` | 下载文件（支持断点续传） |
| DELETE | `/api/delete?path=` | 删除文件/文件夹 |
| POST | `/api/mkdir` | 新建文件夹 |
| POST | `/api/create-file` | 新建文件 |
| GET | `/api/file?path=` | 获取文件内容（文本预览/编辑） |
| POST | `/api/rename` | 重命名 |
