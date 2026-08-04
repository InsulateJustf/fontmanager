# FontManager — AGENTS.md

## Summary

企业内部字体管理 Web 工具。Python + Flask + SQLite + fontTools 单体应用，设计师通过浏览器上传字体文件，系统自动解析元数据、去重、重命名并入库。支持 TTF/OTF/TTC，含 CJK 检测、字体预览、打包下载等功能。部署目标为 Windows Server，同时支持 macOS 本地开发。

## Architecture

```
浏览器(设计师) ──> Flask + Waitress (0.0.0.0:8080)
                       │
                       ├── GET  /                       → static/index.html
                       ├── POST /api/upload             → 批量上传字体
                       ├── GET  /api/fonts              → 字体列表
                       ├── GET  /api/fonts/<id>/file    → 预览/下载单个字体
                       ├── GET  /api/fonts/<id>/subfonts→ TTC 子字体列表
                       ├── GET  /api/fonts/<id>/cjk     → CJK 支持检测
                       ├── DELETE /api/fonts/<id>       → 删除字体
                       ├── GET  /api/fonts/download-all → 打包下载 ZIP
                       │
                       ├── SQLite (fontmanager.db)      → 元数据 + 缓存
                       └── FONT_STORAGE 目录             → 实际字体文件
```

## 项目结构

```
fontmanager/
├── app.py                   # Flask 路由 + Waitress 服务 + 启动扫描
├── font_parser.py           # fontTools 解析、CJK 检测、名称清洗、Windows 字体过滤
├── db.py                    # SQLite CRUD + 自动迁移
├── requirements.txt         # flask, fonttools, waitress
├── start.sh                 # macOS 开发脚本 (支持 -s/-p 参数)
├── start.bat                # Windows 一键启动
├── build.bat                # Windows PyInstaller 打包
├── fontmanager.spec         # PyInstaller 配置
├── .github/workflows/build.yml  # GitHub Actions 自动编译 exe
├── static/
│   ├── index.html           # 单页前端
│   ├── style.css            # 样式 (响应式)
│   └── app.js               # 前端逻辑 (IIFE)
└── fonts/                   # 默认字体存储目录 (gitignore)
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
  - 字重词（Light/Bold/Black 等，按长度优先匹配）
  - 描述词（Demo/Trial/Free/简入繁出 等）
  - 保留中文"繁体"/"简体"当其为名称一部分时
- **文件名生成**: `generate_filename()` → `{FamilyName}-{StyleName}.{ext}`，非法字符替换为 `_`
- **Windows 系统字体过滤**: `is_windows_builtin()` 匹配 100+ 个内置字体名（含中文名如"微软雅黑"、"宋体"）

### 2. TTC 子字体处理 (font_parser.py)

- `get_ttc_subfonts()` 遍历所有子字体，返回 `{index, family_name, style_name, region, weight}`
- **区域检测**（三级策略）:
  1. `_detect_region_from_name(family)` — 正则匹配字体名中的区域代码
  2. `_detect_region_from_name(full_name)` — 回退到全名检测
  3. `_detect_region_from_langid(name_table)` — 回退到 name table langID (2052=SC, 1028=TC, 1041=JA, 1042=KO)
- **字重检测**: 从 style_name 和 family_name 中匹配英文/中文字重词
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

### 4. 数据库 (db.py)

SQLite 表 `fonts`:

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增 ID |
| family_name | TEXT | 字体家族名 |
| style_name | TEXT | 样式名 |
| format | TEXT | ttf/otf/ttc |
| file_size | INTEGER | 文件大小 (bytes) |
| file_hash | TEXT | SHA256 |
| stored_filename | TEXT | 服务器存储文件名 (重命名后) |
| original_filename | TEXT | 上传时原始文件名 |
| cjk_info | TEXT (JSON) | CJK 支持信息缓存 |
| subfonts_info | TEXT (JSON) | TTC 子字体列表缓存 |
| created_at | TIMESTAMP | 入库时间 |

- UNIQUE 约束: `(family_name, style_name)`
- `init_db()` 自动迁移：检测并添加缺失的 `cjk_info`/`subfonts_info` 列
- `get_all_fonts()` 自动恢复：表不存在时重建

### 5. 上传流程 (app.py → POST /api/upload)

```
接收 multipart files → 逐个处理:
  1. detect_format() 检查扩展名
  2. 写入临时文件
  3. parse_font() 解析元数据
  4. is_windows_builtin() → 跳过系统字体 (status: "skipped")
  5. get_font_by_family_style() 查重
     - 已存在且旧的更完整 → 跳过 (status: "duplicate")
     - 已存在且新的更完整 → 删除旧文件+记录，继续入库
  6. generate_filename() 重命名，冲突时加 _1/_2 后缀
  7. shutil.move() 移动到 FONT_STORAGE
  8. 计算 SHA256 + CJK 检测 + TTC 子字体解析
  9. insert_font() 写入数据库
```

- **完整性比较**: `_is_more_complete()` 先按格式优先级 (TTC=3 > OTF=2 > TTF=1)，同格式比文件大小

### 6. 启动扫描 (app.py → scan_fonts_directory())

服务启动时自动扫描 FONT_STORAGE 目录：

```
遍历目录中所有 .ttf/.otf/.ttc 文件:
  - 已在数据库中 (按 stored_filename 匹配) → 跳过
  - parse_font() 解析 → is_windows_builtin() 过滤系统字体
  - 已有同 family+style 记录 → 比较完整性，保留更完整的
  - 生成规范文件名 → 必要时重命名
  - 计算元数据 → insert_font() 入库
```

### 7. API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 前端页面 |
| POST | `/api/upload` | 批量上传字体 |
| GET | `/api/fonts` | 字体列表 |
| GET | `/api/fonts/<id>/file` | 预览字体文件；`?download=1` 下载；`?subfont=N` 提取 TTC 子字体 |
| GET | `/api/fonts/<id>/subfonts` | TTC 子字体列表 (缓存) |
| GET | `/api/fonts/<id>/cjk` | CJK 支持信息 (缓存)；`?subfont=N` 检测特定子字体 |
| DELETE | `/api/fonts/<id>` | 删除字体 (文件+记录) |
| GET | `/api/fonts/download-all` | 打包所有字体为 ZIP 下载 |

### 8. 前端 (static/)

- **上传区**: 拖拽 dropzone + 文件选择按钮 + 文件夹选择按钮，前端过滤非字体文件
- **上传结果**: 逐条显示状态图标（✅成功 / ⚠️重复 / ⏭️跳过系统字体 / ❌失败）
- **字体列表表格**: 字体名称、样式、中文支持徽章（简/繁/日/韩/无）、格式、大小、操作按钮
- **字体预览**: 模态框 + @font-face 加载，支持：
  - TTC 子字体选择器（按区域分组：SC/TC/HK/JP/KR）
  - 自定义预览文字
  - 字号滑块 (12-120px)
  - CJK 警告提示（日文字形警告）
- **下载**: 单个字体下载 (使用重命名后的文件名)、打包下载全部
- **响应式**: 640px 以下隐藏格式/大小列

### 9. 部署方式

**方式一: Python 环境**
- Windows: 双击 `start.bat`（自动创建 venv、安装依赖）
- macOS: `bash start.sh [-s 存储目录] [-p 端口]`
- 环境变量: `FONT_STORAGE` 自定义存储路径、`FONT_PORT` 自定义端口、`FONT_HOST` 自定义监听地址
- 默认存储: Windows `C:\ProgramData\FontManager\fonts\`，其他 `./fonts/`

**方式二: 单文件 exe**
- 运行 `build.bat` 或 GitHub Actions 自动构建
- 输出 `dist/FontManager.exe`，无需 Python 环境
- 可用 NSSM 注册为 Windows 服务

**GitHub Actions (`.github/workflows/build.yml`)**:
- 触发条件: push/PR 到 main 分支，或 tag `v*`
- 仅编译 main 分支内容，不编译 test 分支
- 构建产物: `FontManager.exe` (保留 90 天)
- tag 推送时自动创建 Release

### 10. 开发约定

- **Python 版本**: 3.9+（使用 `typing.Optional`、`typing.List` 等旧式类型注解）
- **分支策略**: `main` 为稳定分支，`test` 为开发分支，测试通过后合并到 main
- **提交风格**: 简短中文 commit message
- **日志**: fontTools 日志级别设为 ERROR 以抑制警告
- **字体名称优先级**: 中文名优先（family_name），英文名优先（style_name）
- **前端版本**: HTML/JS/CSS 通过 `?v=N` 查询参数控制缓存

### 11. 关键设计决策

| 决策 | 说明 |
|------|------|
| Waitress 而非 Gunicorn | Windows 兼容，无需编译 C 扩展 |
| SQLite 而非外部 DB | 单机部署，零依赖，文件级存储 |
| cjk_info/subfonts_info 缓存在 DB | 避免每次请求解析大 TTC 文件 (170MB+) |
| TTC cmap 只查第一个子字体 | 所有子字体共享字形集 |
| 完整性优先而非先到先得 | TTC > OTF > TTF，同格式大文件优先 |
| 启动时自动扫描目录 | 支持手动放入字体文件后重启即入库 |
| Windows 系统字体自动跳过 | 避免与系统自带字体冲突 |
