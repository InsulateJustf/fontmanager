# FontManager — 企业内部字体管理系统

[![纯 AI 零人工](https://img.shields.io/badge/🤖_纯_AI_零人工-100%25-blueviolet?style=flat-square)](https://github.com/InsulateJustf/fontmanager)
[![Build Status](https://img.shields.io/github/actions/workflow/status/InsulateJustf/fontmanager/build.yml?branch=main&style=flat-square&label=main%20build)](https://github.com/InsulateJustf/fontmanager/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/InsulateJustf/fontmanager?style=flat-square&color=green)](https://github.com/InsulateJustf/fontmanager/releases/latest)

供设计师团队使用的 Web 字体管理工具。支持拖拽上传、自动解析元数据、去重、重命名并入库，含 CJK 检测、TTC 子字体管理、字体预览、家族分组、多选下载等功能。

## 功能

- **拖拽上传** — 将字体文件拖到网页即可批量上传，支持文件夹选择（含嵌套子目录递归读取）
- **文件夹多选上传** — 选择文件夹后可累加多个文件夹，最后统一上传
- **自动识别** — 解析 TTF / OTF / TTC 字体的家族名、样式名、区域、字重
- **自动去重** — 按 `(family_name, style_name)` 判断重复，优先保留更完整的版本（TTC > OTF > TTF，同格式取大文件）
- **TTC 覆盖检测** — 自动检测 OTF/TTF 文件是否已被 TTC 覆盖，避免重复入库
- **上传顺序优化** — 多文件上传时 TTC 优先处理，确保 OTF/TTF 能正确检测重复
- **自动重命名** — 文件名统一为 `字体家族名-样式名.扩展名`
- **CJK 检测** — 分析字体的中文支持情况（简体 / 繁体 / 日文 / 韩文），显示徽章和警告
- **TTC 子字体管理** — 查看 TTC 内所有子字体，按区域（SC/TC/HK/JP/KR）分组显示，支持单独预览和下载
- **字体预览** — 通过 @font-face 实时加载预览，支持自定义文字、字号滑块（12–120px），居中弹窗显示
- **家族分组** — 同一家族的多个字重自动归组显示，可展开/收起查看各字重详情
- **多选下载** — 勾选多个字体后一键打包下载 ZIP
- **批量标签** — 多选字体后可批量添加/删除标签
- **按家族下载** — 一键打包同家族所有字重为 ZIP 下载
- **Windows 系统字体过滤** — 自动跳过 100+ 个 Windows 内置字体（含"微软雅黑"、"宋体"、"等线"等）
- **打包下载** — 一键打包所有字体为 ZIP 下载
- **启动自动扫描** — 服务启动时自动扫描字体存储目录，将未入库的字体自动导入
- **删除二次确认** — 两次确认后才会执行删除，防止误删（需按科乐美密技显示删除按钮）
- **非标准命名修正** — 自动检测字重藏在 family 名中的字体（如 HomuraM 系列），修正元数据
- **字体备份与还原** — 修改字体前自动备份原文件到 `fonts/backup/`，替换时也自动备份，支持手动还原到原始版本
- **字形安全比对** — 修改字体后自动比对字形数据，确保无损坏，异常时自动还原
- **版本号显示** — 侧边栏底部显示当前版本号（主分支显示 commit id，测试分支显示 test-commit id）

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.9+ / Flask / Waitress / fontTools / SQLite |
| 前端 | React 19 / Vite / TypeScript / Tailwind CSS 4 / shadcn/ui |
| 部署 | PyInstaller 单文件 exe / GitHub Actions 自动构建 |

## 快速开始

### macOS 本地开发

```bash
# 克隆仓库
git clone <repo-url> && cd fontmanager

# 一键启动（自动创建 venv、安装依赖、构建前端）
bash start.sh

# 自定义存储目录和端口
bash start.sh -s ~/MyFonts -p 9090
```

### Windows Server 部署

#### 方式一：Python 环境

1. 确保已安装 Python 3.9+（已加入 PATH）
2. 将整个 `fontmanager` 文件夹复制到服务器
3. 双击 `start.bat`（首次运行自动创建 venv 并安装依赖）
4. 访问 `http://服务器IP:8080`

#### 方式二：单文件 exe（无需 Python 环境）

1. 运行 `build.bat` 或通过 GitHub Actions 自动构建
2. 将 `dist/FontManager.exe` 复制到服务器
3. 双击运行，访问 `http://服务器IP:8080`

> **⚠️ Windows Defender 误报说明**  
> PyInstaller 打包的 exe 可能被 Windows Defender 识别为威胁（这是 PyInstaller 的已知问题，非实际病毒）。如果遇到此情况：
> 1. 在弹出的威胁警告中选择「允许」或「还原」
> 2. 或者打开 Windows 安全中心 → 病毒和威胁保护 → 管理设置 → 排除项，添加 FontManager.exe 所在文件夹
> 3. 也可以将文件提交至 [Microsoft 误报分析页面](https://www.microsoft.com/en-us/wdsi/filesubmission) 进行申诉
> 
> 本项目代码完全开源，不含任何恶意代码。误报原因是 PyInstaller bootloader 的特征码被 AV 厂商标记，以及未签名的可执行文件更容易触发启发式检测。

可选：使用 [NSSM](https://nssm.cc/) 注册为 Windows 服务：

```cmd
nssm install FontManager "C:\path\to\FontManager.exe"
nssm start FontManager
```

### GitHub Actions 自动构建

- **main 分支** (`build.yml`): push / PR 到 main 或推送 `v*` tag 时自动触发，产物保留 90 天，tag 推送时自动创建 Release
- **test 分支** (`build-test.yml`): 仅手动触发（workflow_dispatch），产物保留 30 天

## 前端开发

前端使用 React + Vite 构建，源码位于 `frontend/` 目录。

```bash
cd frontend
npm install

# 开发模式（自动 proxy API 到 Flask 8080 端口）
npm run dev

# 构建生产版本（输出到 static/）
npm run build
```

### 布局

```
┌──────────────┬──────────────────────────────────────────┐
│   侧边栏     │              主区域                       │
│  (260px)     │                                          │
│              │  [搜索框]  [筛选: 格式|语言|字重]          │
│  📁 上传区    │  ┌──────────────────────────────────────┐│
│  拖拽/选择    │  │ ☐ │ 字体名称  │ 样式  │ CJK │ 格式 │││
│              │  │───│───────────│───────│─────│──────│││
│  🔍 筛选器    │  │ ☐ │ 思源宋体 ▶│ 6个字重│ 简繁 │ TTC │││
│  □ 格式筛选   │  │   │   Regular │       │ 简繁 │ TTC │││
│  □ 语言筛选   │  │   │   Bold    │       │ 简繁 │ TTC │││
│              │  └──────────────────────────────────────┘│
│  🏷️ 标签     │  ┌──────────────────────────────────────┐│
│  + 品牌字体   │  │ 已选择 3 个字体    [取消] [下载选中]  ││
│  + 项目A字体  │  └──────────────────────────────────────┘│
│              │                                          │
│  📊 统计      │              ← 点击字体行 →               │
│  共 N 个字体  │                           ┌─ 预览面板 ──┐│
│  TTC/OTF/TTF │                           │ 字体预览     ││
│              │                           │ 字号滑块     ││
│  📦 打包下载  │                           │ 子字体选择   ││
│              │                           │ CJK 信息     ││
│              │                           │ [下载] [删除]││
│              │                           └──────────────┘│
└──────────────┴──────────────────────────────────────────┘
```

- 多字重家族自动归组，点击展开/收起查看各字重
- 每行左侧复选框支持多选，表头全选按钮（三态）
- 家族标题行带 📦 按钮，一键下载同家族全部字重 ZIP
- TTC 子字体选择器按区域分组，标签显示 variant + weight（区分 Mono 等变体）

## 配置

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `FONT_STORAGE` | 字体存储目录 | Windows: `C:\ProgramData\FontManager\fonts\`，其他: `./fonts/` |
| `FONT_PORT` | 服务端口 | `8080` |
| `FONT_HOST` | 监听地址 | `0.0.0.0` |

也可通过命令行参数指定：

```bash
python app.py --port 9090 --storage /path/to/fonts
```

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 前端页面 |
| POST | `/api/upload` | 批量上传字体 |
| GET | `/api/fonts` | 字体列表 |
| GET | `/api/fonts/<id>/file` | 预览/下载字体文件（`?download=1` 下载，`?subfont=N` 提取 TTC 子字体） |
| GET | `/api/fonts/<id>/subfonts` | TTC 子字体列表（带缓存） |
| GET | `/api/fonts/<id>/cjk` | CJK 支持信息（带缓存，`?subfont=N` 检测特定子字体） |
| DELETE | `/api/fonts/<id>` | 删除字体（文件 + 记录，需二次确认） |
| GET | `/api/fonts/download-all` | 打包下载全部字体（ZIP） |
| GET | `/api/fonts/download-family` | 按家族下载 ZIP（`?name=<family_name>`） |
| POST | `/api/fonts/download-selected` | 多选下载 ZIP（body: `{ids: number[]}`） |
| POST | `/api/fonts/<id>/restore` | 还原字体到备份版本 |

## 项目结构

```
fontmanager/
├── app.py                  # Flask 路由 + Waitress 服务 + 启动扫描 + 子目录迁移
├── font_parser.py          # fontTools 解析、CJK 检测、名称清洗、Windows 字体过滤、cmap 指纹
├── db.py                   # SQLite CRUD + 自动迁移
├── requirements.txt        # flask, fonttools, waitress
├── start.sh                # macOS 开发启动脚本（支持 -s/-p 参数，自动构建前端）
├── start.bat               # Windows 一键启动
├── build.bat               # Windows PyInstaller 打包
├── fontmanager.spec        # PyInstaller 配置
├── .github/workflows/
│   ├── build.yml           # GitHub Actions main 分支自动编译 exe
│   └── build-test.yml      # GitHub Actions test 分支手动编译 exe
├── frontend/               # React 前端源码
│   ├── src/
│   │   ├── components/     # UI 组件（Sidebar, FontTable, FontPreview, UploadResults...）
│   │   │   └── ui/         # shadcn/ui 组件库
│   │   ├── lib/            # api.ts（API 封装）、utils.ts
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
├── static/                 # Vite 构建输出（Flask 直接服务）
├── fonts/                  # 默认字体存储目录（.gitignore）
│   ├── 单字体文件.ttf       # 单字重家族：扁平存储
│   ├── 多字重家族/          # 多字重家族：按家族名归入子目录
│   └── backup/              # 字体备份目录（修改前自动备份）
```

## 存储策略

字体文件按家族名智能组织：

- **单字重家族** — 扁平存储：`fonts/华文细黑-Regular.ttf`
- **多字重家族** — 子目录存储：`fonts/HomuraM/HomuraM-ExtraLight.otf`
- 上传时自动检测，已有同家族字体时创建子目录并归入
- 启动时自动迁移已有的多字重家族到子目录

## 上传流程

```
接收文件 → 逐个处理:
  1. 检查扩展名（.ttf/.otf/.ttc）
  2. 解析字体元数据（family_name, style_name）
  3. cmap 指纹检测 + 非标准命名修正
  4. 过滤 Windows 系统内置字体
  5. 查重：已存在且旧的更完整 → 跳过；新的更完整 → 替换
  6. 生成规范文件名，按家族名存储（扁平或子目录）
  7. 计算 SHA256 + CJK 检测 + TTC 子字体解析
  8. 写入数据库
```

## 数据库

SQLite 表 `fonts`：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增 ID |
| family_name | TEXT | 字体家族名 |
| style_name | TEXT | 样式名 |
| format | TEXT | ttf / otf / ttc |
| file_size | INTEGER | 文件大小（bytes） |
| file_hash | TEXT | SHA256 |
| stored_filename | TEXT | 服务器存储文件名（含子目录路径） |
| original_filename | TEXT | 上传时原始文件名 |
| cjk_info | TEXT (JSON) | CJK 支持信息缓存 |
| subfonts_info | TEXT (JSON) | TTC 子字体列表缓存 |
| cmap_fingerprint | TEXT (JSON) | cmap 指纹缓存 |
| backup_filename | TEXT | 备份文件路径 |
| created_at | TIMESTAMP | 入库时间 |

唯一约束：`(family_name, style_name)`

## 开发约定

- **Python 3.9+** — 使用 `typing.Optional`、`typing.List` 等旧式类型注解
- **前端技术** — React 19 + Vite + TypeScript + Tailwind CSS 4 + shadcn/ui
- **分支策略** — `main` 为稳定分支，`test` 为开发分支
- **提交风格** — 简短中文 commit message
- **提交/推送** — 任何 git commit 和 push 操作必须由用户明确批准
- **测试流程** — 新功能或 Bug 修复后向用户报告改动，等待用户手动测试确认
