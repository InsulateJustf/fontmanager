 # FontManager — 企业内部字体管理系统

  ## Summary

  在 Windows Server 上部署一个基于 Python + Flask 的 Web 字体管理工具，设计师通过浏览器拖拽上传字体文件，系统自动解析字体元数据、去重、重命名并入库。前端为单页应用，后端
  API 负责解析和存储。

  ———

  ## Architecture

  浏览器(设计师)  ──>  Flask Web Server (端口 8080)
                           │
                           ├── /static/          前端页面
                           ├── /api/upload       拖拽上传
                           ├── /api/fonts        字体列表
                           ├── /api/fonts/<id>   删除字体
                           │
                           ├── SQLite DB         字体元数据 (名称/格式/大小/哈希)
                           └── C:\ProgramData\FontManager\fonts\  实际字体文件

  ———

  ## 项目结构

  fontmanager/
  ├── app.py                 # Flask 入口 + 路由
  ├── font_parser.py         # fontTools 解析封装
  ├── db.py                  # SQLite 数据库初始化与操作
  ├── requirements.txt       # Python 依赖
  ├── start.bat              # Windows 一键启动脚本
  ├── static/
  │   ├── index.html         # 单页前端
  │   ├── style.css          # 样式
  │   └── app.js             # 前端逻辑（拖拽、上传、通知）
  └── README.md              # 部署说明

  ———

  ## 核心实现细节

  ### 1. 字体解析 (font_parser.py)

  - 使用 fontTools.ttLib.TTFont 解析 TTF/OTF/TTC
  - 提取字段：
      - familyName (nameID=1) → 字体家族名，如 "思源黑体"
      - styleName (nameID=2) → 样式名，如 "Regular", "Bold", "Italic"
      - version (nameID=5) → 版本号
      - format → 从文件头 magic bytes 判断 TTF/OTF/TTC

  - TTC 处理：整体入库，从 TTFont(file_number=0) 读取第一个子字体的 familyName 作为文件名依据
  - 重命名规则：{familyName}-{styleName}.{ext}，非法字符(/:*?"<>|)替换为 _
  - 去重指纹：对 familyName + styleName 做标准化比较（忽略大小写和首尾空格）

  ### 2. 数据库 (db.py)

  SQLite 表结构 fonts:

   字段                 类型          说明
  ━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━
   id                   INTEGER PK    自增ID
  ───────────────────  ────────────  ──────────────────────
   family_name          TEXT          字体家族名
  ───────────────────  ────────────  ──────────────────────
   style_name           TEXT          样式名
  ───────────────────  ────────────  ──────────────────────
   format               TEXT          ttf/otf/ttc
  ───────────────────  ────────────  ──────────────────────
   file_size            INTEGER       文件大小(bytes)
  ───────────────────  ────────────  ──────────────────────
   file_hash            TEXT          SHA256（额外校验用）
  ───────────────────  ────────────  ──────────────────────
   stored_filename      TEXT          服务器存储文件名
  ───────────────────  ────────────  ──────────────────────
   original_filename    TEXT          上传时原始文件名
  ───────────────────  ────────────  ──────────────────────
   created_at           TIMESTAMP     入库时间

  索引：(family_name, style_name) UNIQUE

  ### 3. 上传接口 (app.py → POST /api/upload`)

  流程：
  1. 接收 multipart/form-data 文件
  2. 写入临时目录
  3. font_parser 解析 → 提取 familyName / styleName
  4. 查 SQLite：是否存在 (family_name, style_name) 记录
  5. 如果存在 → 返回 {status: "duplicate", message: "字体已存在: xxx"}
  6. 如果不存在 →
     a. 重命名为 {familyName}-{styleName}.ext
     b. 移动到 C:\ProgramData\FontManager\fonts\
     c. 插入 SQLite 记录
     d. 返回 {status: "success", font: {...}}
  7. 解析失败 → 返回 {status: "error", message: "无法解析字体文件"}

  批量上传：前端逐个发送文件，每个文件独立处理，汇总结果展示。

  ### 4. 去重扫描 (app.py → POST /api/scan`)

  启动时或手动触发：

  1. 扫描 fonts/ 目录所有文件
  2. 逐个解析，计算 (familyName, styleName)
  3. 检测重复：同一组合出现多次 → 保留第一个，删除后续
  4. 检测未入库文件：存在文件但无 DB 记录 → 自动入库

  ### 5. 前端 (static/index.html + app.js)

  - 拖拽区域：大面积 dropzone，支持多文件拖入
  - 上传时显示进度条 + 文件列表
  - 每个文件显示状态：⏳解析中 / ✅已入库 / ⚠️已存在(重复) / ❌解析失败
  - 已入库字体列表表格（从 GET /api/fonts 获取）
  - 删除按钮（调用 DELETE /api/fonts/<id>）

  ### 6. Windows Server 部署

  requirements.txt:

  flask==3.1.1
  fonttools==4.58.0
  waitress==3.0.2

  start.bat:

  @echo off
  cd /d %~dp0
  python -m venv venv
  call venv\Scripts\activate
  pip install -r requirements.txt
  python app.py

  - 使用 waitress 作为生产 WSGI 服务器（Windows 兼容，无需 gunicorn）
  - 默认监听 0.0.0.0:8080
  - 字体存储目录：C:\ProgramData\FontManager\fonts\（首次启动自动创建）

  ———

  ## Test Plan

  1. 单元测试（开发阶段本地验证）：
      - font_parser.py：传入 TTF/OTF/TTC 样本，验证解析出的 familyName/styleName 正确
      - db.py：插入/查询/去重逻辑正确
      - 重命名：特殊字符替换、中文名支持

  2. 手动测试（部署后验证）：
      - 拖入单个 TTF → 成功入库，文件名正确
      - 再次拖入同一字体 → 提示已存在
      - 拖入 TTC 文件 → 整体入库
      - 拖入非字体文件（如 .txt）→ 提示解析失败
      - 同时拖入 10+ 文件 → 批量处理正常
      - 删除已有字体 → 文件和记录同步删除

  ———

  ## Assumptions

  - Windows Server 已安装 Python 3.9+ 并加入 PATH
  - 不需要用户认证（内网信任环境）
  - 不需要字体预览/下载功能（后续可加）
  - 单服务器单实例，不需要考虑并发写入竞争（内部使用人数有限）
  - 存储目录 C:\ProgramData\FontManager\ 有足够的磁盘空间