# FontManager — 企业内部字体管理系统

供设计师团队使用的 Web 字体管理工具，支持拖拽上传、自动去重、自动重命名。

## 功能

- **拖拽上传**：将字体文件拖到网页即可上传
- **自动识别**：解析 TTF/OTF/TTC 字体的家族名和样式名
- **自动去重**：按字体名称判断重复，已有字体自动跳过并提示
- **自动重命名**：文件名统一为 `字体家族名-样式名.扩展名`
- **字体管理**：查看已入库字体列表，支持删除

## 部署步骤（Windows Server）

### 前置条件

- Windows Server 2016+
- Python 3.9+（已加入 PATH）

### 安装

1. 将整个 `fontmanager` 文件夹复制到服务器
2. 双击 `start.bat`
3. 首次运行会自动创建虚拟环境并安装依赖
4. 启动后访问 `http://服务器IP:8080`

### 手动启动

```cmd
cd fontmanager
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

## 使用方法

1. 打开浏览器访问 `http://服务器IP:8080`
2. 将字体文件（TTF/OTF/TTC）拖拽到页面上方区域
3. 系统自动解析、去重、入库
4. 在下方表格中查看和管理已入库字体

## 配置

默认字体存储目录：`C:\ProgramData\FontManager\fonts\`

可通过环境变量 `FONT_STORAGE` 自定义：

```cmd
set FONT_STORAGE=D:\MyFonts
python app.py
```

## 项目结构

```
fontmanager/
├── app.py              # Flask 主应用
├── font_parser.py      # 字体解析模块
├── db.py               # SQLite 数据库操作
├── requirements.txt    # Python 依赖
├── start.bat           # Windows 一键启动
├── static/
│   ├── index.html      # 前端页面
│   ├── style.css       # 样式
│   └── app.js          # 前端逻辑
└── README.md
```

## 方式二：单文件 exe（无需 Python 环境）

### 构建 exe

1. 在有 Python 环境的机器上运行 `build.bat`
2. 构建完成后，`dist/FontManager.exe` 即为单文件可执行程序

### 部署

1. 将 `FontManager.exe` 复制到 Windows Server
2. 双击运行
3. 访问 `http://服务器IP:8080`

### 自定义存储路径

```cmd
set FONT_STORAGE=D:\MyFonts
FontManager.exe
```

### 作为 Windows 服务运行（可选）

使用 [NSSM](https://nssm.cc/) 将 FontManager 注册为系统服务：

```cmd
nssm install FontManager "C:\path\to\FontManager.exe"
nssm start FontManager
```
