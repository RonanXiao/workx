# workx

workx 是基于 OpenAI Codex `rust-v0.153.4` 的独立项目。

- 上游源码提交：`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`
- 项目仓库：<https://github.com/RonanXiao/workx>
- 当前项目版本：`0.0.1`
- CLI 命令：`workx`
- Rust workspace：`workx-rs/`，crate 前缀：`workx-`
- 默认配置与数据目录：`~/.workx`，覆盖变量：`WORKX_HOME`
- 项目配置目录：`.workx/`；其他本地环境变量使用 `WORKX_` 前缀。
- npm 包名：`@ronanxiao/workx`、`@ronanxiao/workx-sdk`
- Python 包名：`workx`、`workx-cli-bin`；SDK 导入：`import workx`
- macOS 配置及应用标识：`com.ronanxiao.workx`

## Homebrew 安装

```sh
brew tap ronanxiao/workx
brew trust ronanxiao/workx
brew install workx
```

当前 formula 仅支持 macOS，使用仓库打包脚本从源码编译安装，首次安装耗时较长。
如需安装最新 `main`，可执行：

```sh
brew install --HEAD workx
```

## 从源码运行和打包

使用仓库指定的 Rust toolchain，以及 Node.js、pnpm、Python 和 just：

```sh
cd workx-rs
cargo build --release --bin workx
./target/release/workx --help
```

在仓库根目录查看完整分发包的参数：

```sh
just assemble-workx-package --help
```

打包脚本、安装脚本及发布文件使用 workx 名称，安装器默认从本仓库的 GitHub Releases 下载。
当前尚未发布 npm/PyPI 包、GitHub Release 或桌面应用。
上游发布流程仍包含签名、发布凭据和运行环境要求，后续需配置后才能正式发布。

## 模型 provider

首次启动先选择 provider；之后用 `/provider` 添加或切换提供商，再用 `/model` 切换模型。
OpenAI 保留 ChatGPT 登录、Device Code 和 API key 三种认证方式。
自定义服务直接填写地址和 API key，保存到 `~/.workx/config.toml`，界面遮蔽 key，不需要设置环境变量。

使用 `/provider` 管理来源：

- `n` 添加，`e` 查看或修改所选来源；`Enter` 保存/切换并弹出模型选择，也可用 `/model` 随时切换模型。
- 配置 API URL、API key、模型查询地址、协议和可选的默认模型。
- 模型查询地址默认 `/v1/models`，支持以 `/` 开头的同源路径或完整 HTTP(S) URL。
- 协议默认 `responses`；只支持 Chat Completions 的服务选择 `chat`。
- 保存前验证模型目录，失败时提示检查配置。切换后开启新会话，旧会话可继续恢复。
- 自定义来源在启动、切换及打开 `/model` 时查询模型目录，不混入 OpenAI 内置模型或其他来源的缓存。

配置示例：

```toml
model_provider = "my_service"
model = "your-model-id"

[model_providers.my_service]
name = "My model service"
base_url = "https://your-service.example/v1"
experimental_bearer_token = "your-api-key"
models_endpoint = "/v1/models"
wire_api = "responses"
requires_openai_auth = false
```

`experimental_bearer_token` 保存 API key，也可使用配置别名 `api_key`；本地无认证服务可省略。
模型目录支持 `{"data":[{"id":"model-name"}]}` 和原有的详细 `models` 目录。
通用目录没有上下文窗口等能力信息时，不从模型名称猜测；可使用已有模型配置覆盖机制补充。
`wire_api` 也支持显式 `auto`：完整路径 `/chat/completions` 识别为 Chat，其余地址使用 Responses，不发送协议探测请求。

Runtime 内部统一使用 Responses 请求和事件结构。协议适配器负责转换远端接口；配置 `chat` 时实际发送 Chat Completions 请求。
Chat 适配包括文本流、图片、工具调用、工具结果和用量；`reasoning_content` 随历史保存并在后续请求原样回传。
OpenAI 服务端专属工具和远程压缩在普通自定义 provider 下关闭。
新增协议实现 `InferenceProtocol` trait 并加入内置注册后重新编译，不加载动态插件。

## 兼容性与来源

OpenAI 模型 ID、服务地址、OAuth 参数及服务端协议字段保留上游拼写。
固定版本的 V8、zsh 等依赖继续使用原始下载地址与校验信息。
这些值不属于 workx 的本地产品命名空间。workx 不自动迁移或读取 `~/.codex` 的配置。

本项目独立维护，不是 OpenAI 官方发行版。原始代码和第三方版权声明保留于
[LICENSE](LICENSE) 和 [NOTICE](NOTICE)。首个提交是未经修改的上游 tag 源码，第二个提交包含更名。

## 基础验证

```sh
scripts/smoke-test.sh
```

基础验证覆盖 Cargo workspace 路径解析、打包及安装器回归测试；不替代完整编译和全平台测试。
