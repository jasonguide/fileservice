# FileService

一个极简的文件中转站 Web 服务，适用于 NAS 部署场景。在公司/外部电脑上传文件，回家后通过 NAS 访问和下载。

## 功能清单

| 功能 | 说明 |
|------|------|
| 文件列表 | 展示 Name / Last Modified / Size / Actions，支持点击表头排序 |
| 上传文件 | 小文件常规上传；大文件（>50MB）自动分片上传（10MB/片，3路并发） |
| **文件预览** | 图片 / PDF / 视频 / 音频 / 文本代码 / Markdown / SVG / HTML，站内弹窗直接看，无需下载 |
| 下载文件 | 支持 HTTP Range 断点续传 |
| 新建文件夹 | 创建任意层级目录 |
| 新建文件 | 创建空白文本文件 |
| 在线编辑 | 文本文件（.txt/.md/.json/.go/.py 等）在预览弹窗内一键切到编辑并保存 |
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

## 文件预览说明

点击列表中的文件名，或行内的「预览」按钮，即可在站内弹窗中直接查看，无需下载。

### 支持的类型

| 类型 | 扩展名 | 渲染方式 | 可编辑 |
|------|--------|----------|--------|
| 图片 | png jpg jpeg gif webp bmp ico avif tif tiff | `<img>` | — |
| SVG | svg | `<img>`（非脚本上下文，内嵌脚本不执行） | — |
| HTML | html htm | `<iframe sandbox>` + 沙箱 CSP | — |
| PDF | pdf | `<iframe>` + 沙箱 CSP | — |
| 视频 | mp4 m4v webm ogv mov | `<video>`，支持拖拽进度条 | — |
| 音频 | mp3 wav ogg oga opus m4a aac flac | `<audio>` | — |
| Markdown | md markdown | 内置渲染器（标题/列表/代码块/表格/引用/链接） | ✅ |
| 文本 / 代码 | txt log json yml go py js ts java c cpp rs sh sql 等 | `<pre>` 等宽展示 | 见下方「大文件策略」 |

白名单之外的类型（如 zip、可执行文件、无扩展名文件）不提供预览，只能下载——预览是**按类型显式开启**的，而不是对内容做嗅探猜测。

> 注意：avi / mkv / wmv / flv 未列入白名单。浏览器无法原生播放这些容器，与其给一个转不动的播放器，不如直接引导下载。

### 大文件策略

预览和编辑走**两条独立通道**，两者的内存行为完全不同：

| 通道 | 读取量 | 内存占用 | 说明 |
|------|--------|----------|------|
| 预览（文本类） | **恒定 1 MB** | 与文件大小无关 | 超过 1 MB 只显示开头，并提示「仅预览前 1 MB」 |
| 编辑（文本类） | 实际文件大小 | 约 4 倍文件体积 | **上限 32 MB**，超过则拒绝并提示下载 |
| 媒体预览 | 流式传输 | **恒定**（实测 150 MB 视频仅 +0.1 MB） | `http.ServeFile` 按 32 KB 缓冲输出 |

关键点：

- **预览永不读全文。** 打开一个 150 MB 的日志，内存增长实测为 0，而不是修复前的约 600 MB。
- **编辑才加载全文**，且点击编辑时才发起请求——不点就不花这份内存。
- **超过 32 MB 的文件不可在线编辑**（后端返回 413），但仍可预览前 1 MB。这个体量的文本放进文本框本身也没法用。
- **截断预览绝不会造成数据丢失。** 编辑通道加载的是完整内容，保存写回的是完整内容；截断的预览内容永远不会被保存回去。
- 多字节字符不会被截半：截断位置会回退到 UTF-8 字符边界。

> 为什么编辑上限是 32 MB 而不是 100 MB？因为峰值内存约为文件体积的 4 倍（原始字节 + 字符串 + JSON 编码各持一份），而容器内存上限是 200 MB。32 MB 对应约 128 MB 峰值，留有安全余量。

### 关于压缩包

zip / tar / gz / rar / 7z 等压缩格式**不支持预览**，只能下载。它们不在预览白名单内——解包预览需要处理压缩炸弹、路径穿越、中文文件名编码等问题，成本远高于收益。

### 交互说明

- **文件名 / 预览按钮** → 打开预览弹窗
- **弹窗顶栏**：编辑（仅文本类）· 新标签页打开 · 下载 · 关闭
- **编辑切换**：文本类可在预览与编辑之间反复切换，文件内容只拉取一次
- **快捷键**：`Ctrl/Cmd + S` 保存；`Esc` 编辑中先退出编辑态，非编辑态关闭弹窗
- **未保存保护**：编辑中有改动时关闭弹窗会二次确认

### 安全性

预览端点对可执行脚本的类型做了专门处理：

- **SVG** 走 `<img>` 渲染。图片是非脚本上下文，文件内的 `<script>` 不会执行。
- **HTML / PDF** 以 `<iframe sandbox>` 渲染，服务端同时下发 `Content-Security-Policy: sandbox; default-src 'none'; ...`，脚本被浏览器阻止执行。
- 所有预览响应带 `X-Content-Type-Options: nosniff`，杜绝浏览器按内容猜测类型。
- Markdown 渲染器**先转义 HTML 再生成标签**，文档内的 `<script>` 只能作为文本显示；`javascript:`、`data:` 等协议不会被渲染成链接。

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
│   ├── index.html       # 页面（含预览弹窗）
│   ├── style.css        # 样式（含 Markdown 排版）
│   └── app.js           # 前端逻辑（预览分类渲染 + 内置 Markdown 渲染器）
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
| GET | `/api/preview?path=` | 预览文件（inline 输出，支持 Range 断点续传） |
| GET | `/api/file?path=` | 获取文本文件内容（JSON，**恒定最多 1 MB**，超出截断并置 `truncated`） |
| GET | `/api/file?path=&full=1` | 获取完整文本内容供编辑（**上限 32 MB**，超出返回 413） |
| POST | `/api/rename` | 重命名 |
