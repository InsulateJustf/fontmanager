# FontManager — 企业内部字体管理系统

[![纯 AI 零人工](https://img.shields.io/badge/🤖_纯_AI_零人工-100%25-blueviolet?style=flat-square)](https://github.com/InsulateJustf/fontmanager)
[![Build Status](https://img.shields.io/github/actions/workflow/status/InsulateJustf/fontmanager/build.yml?branch=main&style=flat-square&label=main%20build)](https://github.com/InsulateJustf/fontmanager/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/InsulateJustf/fontmanager?style=flat-square&color=green)](https://github.com/InsulateJustf/fontmanager/releases/latest)

供设计师团队使用的 Web 字体管理工具。支持拖拽上传、自动解析元数据、去重、重命名并入库，含 CJK 检测、TTC 子字体管理、字体预览、家族分组、多选下载、标签管理等功能。

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
- **内联预览** — 字体表格中每行显示字体名称的实际渲染效果
- **家族分组** — 同一家族的多个字重自动归组显示，可展开/收起查看各字重详情
- **多选下载** — 勾选多个字体后一键打包下载 ZIP
- **标签管理** — 创建、编辑、删除标签，支持颜色选择（预设 16 种颜色 + 自定义颜色选择器）
- **批量标签** — 多选字体后可批量添加/删除标签
- **按家族下载** — 一键打包同家族所有字重为 ZIP 下载
- **语言筛选** — 支持多选语言筛选（简体中文/繁体中文/日文/韩文/英文）
- **Windows 系统字体过滤** — 自动跳过 100+ 个 Windows 内置字体（含"微软雅黑"、"宋体"、"等线"等）
- **打包下载** — 一键打包所有字体为 ZIP 下载
- **启动自动扫描** — 服务启动时自动扫描字体存储目录，将未入库的字体自动导入
- **删除二次确认** — 两次确认后才会执行删除，防止误删（需按科乐美密技显示删除按钮）
- **管理员模式** — 通过科乐美密技（上上下下左右左右BA）激活，显示删除按钮和隐藏列（格式/大小）
- **非标准命名修正** — 自动检测字重藏在 family 名中的字体（如 HomuraM 系列），修正元数据
- **字体备份与还原** — 修改字体前自动备份原文件到 `fonts/backup/`，替换时也自动备份，支持手动还原到原始版本
- **字形安全比对** — 修改字体后自动比对字形数据，确保无损坏，异常时自动还原
- **版本号显示** — 侧边栏底部显示当前版本号（构建版本从 VERSION 文件读取，开发版本从 git 获取）

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

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
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
| POST | `/api/upload` | 批量上传字体（TTC 优先处理） |
| GET | `/api/fonts` | 字体列表 |
| GET | `/api/fonts/<id>/file` | 预览字体文件；`?download=1` 下载；`?subfont=N` 提取 TTC 子字体 |
| GET | `/api/fonts/<id>/subfonts` | TTC 子字体列表（带缓存） |
| GET | `/api/fonts/<id>/cjk` | CJK 支持信息（带缓存，`?subfont=N` 检测特定子字体） |
| DELETE | `/api/fonts/<id>` | 删除字体（文件 + 记录，需二次确认） |
| POST | `/api/fonts/<id>/restore` | 还原字体到备份版本 |
| GET | `/api/fonts/download-all` | 打包下载全部字体（ZIP） |
| GET | `/api/fonts/download-family` | 按家族下载 ZIP（`?name=<family_name>`） |
| POST | `/api/fonts/download-selected` | 多选下载 ZIP（body: `{ids: number[]}`） |
| GET | `/api/tags` | 标签列表 |
| POST | `/api/tags` | 创建标签 |
| DELETE | `/api/tags/<id>` | 删除标签 |
| PUT | `/api/tags/<id>` | 更新标签（名称/颜色） |
| GET | `/api/fonts/<id>/tags` | 字体的标签列表 |
| POST | `/api/fonts/<id>/tags` | 为字体添加标签 |
| DELETE | `/api/fonts/<id>/tags/<tag_id>` | 从字体删除标签 |
| POST | `/api/fonts/batch/tags` | 批量添加标签（body: `{font_ids: number[], tag_id: number}`） |
| DELETE | `/api/fonts/batch/tags` | 批量删除标签（body: `{font_ids: number[], tag_id: number}`） |
| GET | `/api/version` | 获取当前版本信息（分支+commit id） |

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
├── VERSION                 # 版本号文件（构建时自动生成）
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
接收文件 → 按格式优先级排序（TTC > OTF > TTF）→ 逐个处理:
  1. 检查扩展名（.ttf/.otf/.ttc）
  2. 解析字体元数据（family_name, style_name）
  3. cmap 指纹检测 + 非标准命名修正（TTF/OTF）
  4. 过滤 Windows 系统内置字体
  5. TTC 覆盖检测（OTF/TTF 是否已被 TTC 覆盖）
  6. 查重：已存在且旧的更完整 → 跳过；新的更完整 → 备份+替换
  7. 生成规范文件名，按家族名存储（扁平或子目录）
  8. 计算 SHA256 + CJK 检测 + TTC 子字体解析
  9. 写入数据库（含 cmap_fingerprint）
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

SQLite 表 `tags`：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增 ID |
| name | TEXT | 标签名称（UNIQUE） |
| color | TEXT | 标签颜色（默认 #6b7280） |
| created_at | TIMESTAMP | 创建时间 |

SQLite 表 `font_tags`：

| 字段 | 类型 | 说明 |
|------|------|------|
| font_id | INTEGER | 字体 ID（外键） |
| tag_id | INTEGER | 标签 ID（外键） |

主键：`(font_id, tag_id)`，级联删除。

## 前端功能

- **侧边栏** — 拖拽上传区、文件/文件夹选择按钮（支持累加多文件夹）、标签管理（创建/编辑/删除标签，支持颜色选择）、统计信息、打包下载按钮、版本号显示
- **字体表格** — 家族分组显示、多选复选框、搜索框、格式/语言筛选（支持多选）、列排序、分页、内联预览、批量操作栏
- **字体预览** — @font-face 实时加载、TTC 子字体选择器（按区域分组）、自定义预览文字、字号滑块、CJK 警告、删除/还原操作
- **上传结果** — 逐条显示状态图标（✅成功 / ⚠️重复 / ⏭️跳过系统字体 / ❌失败）
- **管理员模式** — 科乐美密技（上上下下左右左右BA）激活，显示删除按钮和隐藏列

## 开发约定

- **Python 3.9+** — 使用 `typing.Optional`、`typing.List` 等旧式类型注解
- **前端技术** — React 19 + Vite + TypeScript + Tailwind CSS 4 + shadcn/ui
- **分支策略** — `main` 为稳定分支，`test` 为开发分支
- **提交风格** — 简短中文 commit message
- **提交/推送** — 任何 git commit 和 push 操作必须由用户明确批准
- **测试流程** — 新功能或 Bug 修复后向用户报告改动，等待用户手动测试确认
