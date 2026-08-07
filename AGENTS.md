# FontManager — AGENTS.md

## Summary

企业内部字体管理 Web 工具。Python + Flask + SQLite + fontTools 单体应用，设计师通过浏览器上传字体文件，系统自动解析元数据、去重、重命名并入库。支持 TTF/OTF/TTC，含 CJK 检测、字体预览、家族分组、多选下载等功能。部署目标为 Windows Server，同时支持 macOS 本地开发。

## Architecture

```
浏览器(设计师) ──> Flask + Waitress (0.0.0.0:8080)
                       │
                       ├── GET  /                            → static/index.html
                       ├── POST /api/upload                  → 批量上传字体
                       ├── GET  /api/fonts                   → 字体列表
                       ├── GET  /api/fonts/<id>/file         → 预览/下载单个字体
                       ├── GET  /api/fonts/<id>/subfonts     → TTC 子字体列表
                       ├── GET  /api/fonts/<id>/cjk          → CJK 支持检测
                       ├── DELETE /api/fonts/<id>            → 删除字体（二次确认）
                       ├── POST /api/fonts/<id>/restore     → 还原字体到备份版本
                       ├── GET  /api/fonts/download-all      → 打包下载全部 ZIP
                       ├── GET  /api/fonts/download-family   → 按家族下载 ZIP
                       ├── POST /api/fonts/download-selected → 多选下载 ZIP
                       │
                       ├── SQLite (fontmanager.db)           → 元数据 + 缓存
                       └── FONT_STORAGE 目录                  → 实际字体文件
```

## 项目结构

```
fontmanager/
├── app.py                   # Flask 路由 + Waitress 服务 + 启动扫描 + 子目录迁移
├── font_parser.py           # fontTools 解析、CJK 检测、名称清洗、Windows 字体过滤、cmap 指纹
├── db.py                    # SQLite CRUD + 自动迁移
├── requirements.txt         # flask, fonttools, waitress
├── start.sh                 # macOS 开发脚本 (支持 -s/-p 参数，自动构建前端)
├── start.bat                # Windows 一键启动
├── build.bat                # Windows PyInstaller 打包
├── fontmanager.spec         # PyInstaller 配置
├── VERSION                  # 版本号文件（构建时生成，打包到 exe 中）
├── .github/workflows/
│   ├── build.yml            # GitHub Actions main 分支自动编译 exe
│   └── build-test.yml       # GitHub Actions test 分支手动编译 exe
├── frontend/                # React 前端源码
│   ├── src/
│   │   ├── components/
│   │   │   ├── Sidebar.tsx      # 侧边栏：上传区 + 标签 + 统计 + 打包下载
│   │   │   ├── FontTable.tsx    # 字体表格：家族分组、多选、搜索、筛选、分页
│   │   │   ├── FontPreview.tsx  # 右侧滑出预览面板
│   │   │   ├── UploadResults.tsx# 上传结果状态
│   │   │   └── ui/              # shadcn/ui 组件库
│   │   ├── lib/
│   │   │   ├── api.ts           # fetch 封装（对齐后端 API）
│   │   │   └── utils.ts
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
├── static/                  # Vite 构建输出（Flask 直接服务）
├── fonts/                   # 默认字体存储目录 (gitignore)
│   ├── 单字体文件.ttf        # 单字重家族：扁平存储
│   ├── 多字重家族/           # 多字重家族：按家族名归入子目录
│   │   ├── Family-Bold.otf
│   │   └── Family-Light.otf
│   └── backup/               # 字体备份目录（修改前自动备份）
```

## 核心实现

### 1. 字体解析 (font_parser.py)

- **格式检测**: `detect_format()` 按扩展名判断 `.ttf`/`.otf`/`.ttc`
- **单字体解析**: `parse_font()` 用 `TTFont(file, fontNumber=0)` 读取 name table
  - nameID=1 → family_name (优先中文: platformID=3,langID=2052 → 1028 → 1,33 → 英文)
  - nameID=2 → style_name (优先英文)
  - nameID=4 → full_name (用于区域检测回退)
- **TTC 解析**: `parse_ttc()` 从第一个子字体提取 family_name
- **名称清洗**: `_clean_family_name()` 迭代去除：
  - 括号内容（如 `(需授权)`）
  - 字重编号（W1-W9）
  - 区域后缀（SC/TC/HK/JP/KR/CN）
  - 英文字重词（Light/Bold/Black/DemiLight/SemiLight 等，按长度优先匹配）
  - 多字中文字重词（粗体/特粗/纤细 等）
  - 描述词（Demo/Trial/Free/简入繁出 等）
  - **注意**: 不剥离单字中文字重词（"黑"/"细"/"粗"等），避免误伤字体名（如"华文细黑"、"微软雅黑"）
  - **注意**: 清洗后同时去除尾部连字符和空格（`strip(" -_")`）
- **文件名生成**: `generate_filename()` → `{FamilyName}-{StyleName}.{ext}`，非法字符替换为 `_`
- **Windows 系统字体过滤**: `is_windows_builtin()` 匹配 100+ 个内置字体名（含"微软雅黑"、"宋体"、"等线"/DengXian 等）

### 2. TTC 子字体处理 (font_parser.py)

- `get_ttc_subfonts()` 遍历所有子字体，返回 `{index, family_name, style_name, region, weight, variant}`
- **区域检测**（三级策略）:
  1. `_detect_region_from_name(family)` — 正则匹配字体名中的区域代码
  2. `_detect_region_from_name(full_name)` — 回退到全名检测
  3. `_detect_region_from_langid(name_table)` — 回退到 name table langID (2052=SC, 1028=TC, 1041=JA, 1042=KO)
- **字重检测**: 从 style_name 和 family_name 中匹配英文/多字中文字重词（按长度优先，避免 "DemiLight" 误匹配为 "Light"）
- **变体检测**: 从 family_name 中检测 "Mono" 等变体标记，避免与同 family 的非 Mono 变体产生重复
- 前端按区域分组显示：简体中文 (SC)、繁体中文 (TC)、香港繁体 (HK)、日文 (JP)、韩文 (KR)

### 3. CJK 检测 (font_parser.py)

- `get_cjk_support()` 分析字体的中文支持情况
- 返回 `{has_cjk, cjk_count, supports_sc/tc/ja/ko, languages, warning}`
- **检测信号**:
  - cmap 中 U+4E00-U+9FFF 范围的码位数量
  - name table 中的 langID（SC/TC/JA/KO）
  - OS/2 表的 ulCodePageRange1 位 17-20
- **TTC 优化**: cmap 只检查第一个子字体（共享字形），name table 采样最多 5 个子字体
- **警告**: 当检测到日文字形但无简/繁中文字形时，提示"该子字体使用日本字形，中文显示可能不规范"

### 4. 字形比对与备份还原

- **字形比对**: `compare_font_glyphs()` 比对两个字体文件的字形数据（charstring 指令）
  - 采样 100 个字形进行比对，确保修改后数据无损坏
  - 返回 `{match, checked, mismatches, error}` 结构
- **备份机制**: 修改字体前自动备份到 `fonts/backup/` 目录
  - 备份文件名格式: `{原始文件名}_{时间戳}.{扩展名}`
  - 备份路径存储在数据库 `backup_filename` 字段
- **还原机制**: 
  - 自动还原: 字形比对失败时自动还原原文件
  - 手动还原: 通过 `/api/fonts/<id>/restore` API 还原
  - 前端入口: 双击预览面板标题栏显示还原按钮（隐藏设计，防止误操作）

### 5. cmap 指纹与名称修正 (font_parser.py)

- `compute_cmap_fingerprint(filepath)` — 对 TTF/OTF 计算 cmap 指纹（hash + 字形数 + 版本号）
- `get_raw_family_name(filepath)` — 获取清洗前的原始 family_name
- `is_non_standard_naming(family, style)` — 检测"字重藏在 family 名、style=Regular"的非标准命名
- `extract_weight_from_name(name)` — 从 family 名提取字重词和基名
- `detect_common_base_name(names)` — 从多个 family 名提取公共基名
- **用途**: 上传时自动检测非标准命名（如 HomuraM 系列），从 raw name 提取正确的 base + weight，更新数据库元数据
- **仅修改 DB 元数据**，不修改字体文件本身（避免 fontTools 保存 CFF 字体时丢失数据）

### 5. 数据库 (db.py)

SQLite 表 `fonts`:

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增 ID |
| family_name | TEXT | 字体家族名 |
| style_name | TEXT | 样式名 |
| format | TEXT | ttf/otf/ttc |
| file_size | INTEGER | 文件大小 (bytes) |
| file_hash | TEXT | SHA256 |
| stored_filename | TEXT | 服务器存储文件名（含子目录路径，如 `FamilyName/file.otf`） |
| original_filename | TEXT | 上传时原始文件名 |
| cjk_info | TEXT (JSON) | CJK 支持信息缓存 |
| subfonts_info | TEXT (JSON) | TTC 子字体列表缓存 |
| cmap_fingerprint | TEXT (JSON) | cmap 指纹缓存（hash + glyph_count + version） |
| backup_filename | TEXT | 备份文件路径（修改前自动备份） |
| created_at | TIMESTAMP | 入库时间 |

- UNIQUE 约束: `(family_name, style_name)`
- `init_db()` 自动迁移：检测并添加缺失的列
- `get_all_fonts()` 自动恢复：表不存在时重建
- `get_fonts_by_family(family_name)` 按家族名查询所有字重
- `get_fonts_by_fingerprint(hash)` 按 cmap 指纹查询同源字体

### 6. 存储策略 (app.py)

字体文件按家族名组织存储：

```
fonts/
├── 华文细黑-Regular.ttf          # 单字重家族：扁平存储
├── 方正新秀丽繁体-Regular.ttf     # 单字重家族：扁平存储
├── HomuraM/                      # 多字重家族：按家族名归入子目录
│   ├── HomuraM-ExtraLight.otf
│   └── HomuraM-Light.otf
└── Trajan Pro/
    ├── Trajan Pro-Bold.otf
    └── Trajan Pro-Regular.ttf
```

- 上传时检查 DB 中是否已有同家族字体
- 有 → 创建子目录，新文件存入子目录，已有扁平文件也移入子目录（`_consolidate_family()`）
- 没有 → 扁平存储
- 启动时自动迁移：对 2+ 字体的家族执行子目录归入（`migrate_flat_to_subdirs()`）

### 7. 上传流程 (app.py → POST /api/upload)

```
接收 multipart files → 按格式优先级排序（TTC > OTF > TTF）→ 逐个处理:
  1. detect_format() 检查扩展名
  2. 写入临时文件
  3. parse_font() 解析元数据（优先使用 nameID=16 Typographic Family Name）
  4. cmap 指纹检测 + 非标准命名修正（TTF/OTF）
  5. is_windows_builtin() → 跳过系统字体 (status: "skipped")
  6. _is_covered_by_ttc() → 检测 OTF/TTF 是否已被 TTC 覆盖，跳过重复
  7. get_font_by_family_style() 查重
     - 已存在且旧的更完整 → 跳过 (status: "duplicate")
     - 已存在且新的更完整 → 备份旧文件+删除旧文件+记录，继续入库
  8. generate_filename() + 按家族名存储（扁平或子目录）
  9. 计算 SHA256 + CJK 检测 + TTC 子字体解析
  10. insert_font() 写入数据库（含 cmap_fingerprint）
```

### 8. 启动扫描 (app.py → scan_fonts_directory())

服务启动时自动扫描 FONT_STORAGE 目录（含子目录）：

```
遍历目录中所有 .ttf/.otf/.ttc 文件（含子目录）:
  - 已在数据库中 (按 stored_filename 匹配) → 跳过
  - parse_font() 解析 → is_windows_builtin() 过滤系统字体
  - _is_covered_by_ttc() → 检测 OTF/TTF 是否已被 TTC 覆盖，跳过重复
  - cmap 指纹检测 + 非标准命名修正
  - 已有同 family+style 记录 → 比较完整性，保留更完整的
  - 生成规范文件名 → 按家族名存储
  - 计算元数据 → insert_font() 入库
```

### 9. API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 前端页面 |
| POST | `/api/upload` | 批量上传字体（TTC 优先处理） |
| GET | `/api/fonts` | 字体列表 |
| GET | `/api/fonts/<id>/file` | 预览字体文件；`?download=1` 下载；`?subfont=N` 提取 TTC 子字体 |
| GET | `/api/fonts/<id>/subfonts` | TTC 子字体列表 (缓存) |
| GET | `/api/fonts/<id>/cjk` | CJK 支持信息 (缓存)；`?subfont=N` 检测特定子字体 |
| DELETE | `/api/fonts/<id>` | 删除字体 (文件+记录) |
| POST | `/api/fonts/<id>/restore` | 还原字体到备份版本 |
| GET | `/api/fonts/download-all` | 打包所有字体为 ZIP 下载 |
| GET | `/api/fonts/download-family` | 按家族名打包 ZIP；`?name=<family_name>` |
| POST | `/api/fonts/download-selected` | 多选下载 ZIP；body: `{ids: number[]}` |
| GET | `/api/tags` | 标签列表 |
| POST | `/api/tags` | 创建标签 |
| DELETE | `/api/tags/<id>` | 删除标签 |
| GET | `/api/fonts/<id>/tags` | 字体的标签列表 |
| POST | `/api/fonts/<id>/tags` | 为字体添加标签 |
| DELETE | `/api/fonts/<id>/tags/<tag_id>` | 从字体删除标签 |
| POST | `/api/fonts/batch/tags` | 批量添加标签；body: `{font_ids: number[], tag_id: number}` |
| DELETE | `/api/fonts/batch/tags` | 批量删除标签；body: `{font_ids: number[], tag_id: number}` |
| GET | `/api/version` | 获取当前版本信息（分支+commit id） |

### 10. 前端 (frontend/)

前端使用 React 19 + Vite + TypeScript + Tailwind CSS 4 + shadcn/ui 构建。

- **侧边栏 (Sidebar.tsx)**: 拖拽上传区（支持递归读取嵌套文件夹）、文件/文件夹选择按钮（支持累加多文件夹）、标签管理、统计信息、打包下载按钮、版本号显示
- **字体表格 (FontTable.tsx)**:
  - 按 `family_name` 家族分组显示，多字重家族显示为可展开/收起的分组
  - 每行左侧复选框，支持多选；表头全选（三态）；家族标题行一键选中整个家族
  - 选中后底部操作栏：显示选中数量 + 取消选择 + 下载选中按钮
  - 家族标题行带 📦 按钮，一键下载同家族全部字重 ZIP
  - 搜索框、格式/语言筛选、列排序、分页（每页 50 个家族）
  - 操作按钮：预览、下载（删除按钮需按科乐美密技显示）
  - 多选后底部操作栏：批量下载 + 批量添加/删除标签
- **字体预览 (FontPreview.tsx)**: 居中弹窗 + @font-face 加载，支持：
  - TTC 子字体选择器（按区域分组：SC/TC/HK/JP/KR，标签显示 variant + weight 以区分 Mono 等变体）
  - 自定义预览文字
  - 字号滑块 (12-120px)
  - CJK 警告提示（日文字形警告）
  - 删除操作（二次确认）
  - 还原操作（双击标题栏显示，隐藏设计防误触）
- **上传结果 (UploadResults.tsx)**: 逐条显示状态图标（✅成功 / ⚠️重复 / ⏭️跳过系统字体 / ❌失败）
- **响应式**: 640px 以下隐藏格式/大小列

### 11. 部署方式

**方式一: Python 环境**
- Windows: 双击 `start.bat`（自动创建 venv、安装依赖）
- macOS: `bash start.sh [-s 存储目录] [-p 端口]`（自动构建前端）
- 环境变量: `FONT_STORAGE` 自定义存储路径、`FONT_PORT` 自定义端口、`FONT_HOST` 自定义监听地址
- 默认存储: Windows `C:\ProgramData\FontManager\fonts\`，其他 `./fonts/`

**方式二: 单文件 exe**
- 运行 `build.bat` 或 GitHub Actions 自动构建
- 输出 `dist/FontManager.exe`，无需 Python 环境
- 内含 VERSION 文件，显示正确的版本号
- 可用 NSSM 注册为 Windows 服务

**GitHub Actions**:
- `build.yml`: push/PR 到 main 分支或 tag `v*` 时自动触发，产物保留 90 天，tag 推送时自动创建 Release
- `build-test.yml`: 仅 `workflow_dispatch` 手动触发，checkout test 分支，产物保留 30 天

### 12. 开发约定

- **Python 版本**: 3.9+（使用 `typing.Optional`、`typing.List` 等旧式类型注解）
- **前端技术**: React 19 + Vite + TypeScript + Tailwind CSS 4 + shadcn/ui
- **分支策略**: `main` 为稳定分支，`test` 为开发分支，测试通过后合并到 main
- **提交风格**: 简短中文 commit message
- **日志**: fontTools 日志级别设为 ERROR 以抑制警告
- **字体名称优先级**: 中文名优先（family_name），英文名优先（style_name）
- **前端构建**: `cd frontend && npm run build` 输出到 `static/`，Flask 直接服务
- **前端开发**: `cd frontend && npm run dev` 启动 Vite dev server，自动 proxy API 到 Flask 8080 端口
- **提交流程**: 任何 git commit 操作（包括 test 分支）都必须由用户明确批准后执行，禁止自动提交
- **推送流程**: 任何 git push 操作都必须由用户明确批准后执行，禁止自动推送
- **测试流程**: 每次实现新功能或修复 Bug 后，向用户报告改动内容，等待用户手动测试并确认无误后，由用户发起提交和推送要求
- **分支工作流**: 所有开发操作（代码修改、新功能、Bug 修复）必须在 `test` 分支上进行，用户确认无误后再合并并推送到 `main` 分支

### 13. 关键设计决策

| 决策 | 说明 |
|------|------|
| Waitress 而非 Gunicorn | Windows 兼容，无需编译 C 扩展 |
| SQLite 而非外部 DB | 单机部署，零依赖，文件级存储 |
| cjk_info/subfonts_info 缓存在 DB | 避免每次请求解析大 TTC 文件 (170MB+) |
| TTC cmap 只查第一个子字体 | 所有子字体共享字形集 |
| 完整性优先而非先到先得 | TTC > OTF > TTF，同格式大文件优先 |
| 启动时自动扫描目录 | 支持手动放入字体文件后重启即入库 |
| Windows 系统字体自动跳过 | 避免与系统自带字体冲突 |
| 不合并同家族字体为 TTC | 原始文件保持不变，通过前端分组+批量下载实现等效功能 |
| 修改字体前自动备份 | 原文件备份到 fonts/backup/，支持手动还原 |
| 替换字体时也备份 | 新字体更完整替换旧字体时，也自动备份旧文件 |
| 字形安全比对 | 修改后自动比对字形数据，异常时自动还原 |
| 删除按钮隐藏 | 删除按钮需按科乐美密技（上上下下左右左右BA）显示，防止误删 |
| TTC 覆盖检测 | 上传/扫描时自动检测 OTF/TTF 是否已被 TTC 覆盖，避免重复入库 |
| TTC 优先处理 | 多文件上传时按格式排序（TTC > OTF > TTF），确保 TTC 先入库 |
| 名称优先使用 nameID=16 | 优先使用 Typographic Family Name，避免字重名混入家族名 |
| 变体标记剥离 | TTC 查找公共名称时剥离 Mono 等变体标记 |
| HW 后缀剥离 | 名称清洗时剥离 HW（半宽）后缀 |
| 名称清洗不剥离单字中文权重 | 避免"华文细黑"→"华文"、"微软雅黑"→"微软雅"等误伤 |
| 多字重家族用子目录存储 | 单字体扁平、多字体归入 `fonts/FamilyName/`，保持目录整洁 |
| 版本号显示 | 侧边栏底部显示当前版本，优先从 VERSION 文件读取，其次从 git 获取 |
