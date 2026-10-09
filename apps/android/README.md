# Odyssey 安卓版

把本地单机版的 Odyssey 装进手机：App 在手机上运行 Odyssey 的 Go 服务（只监听 `127.0.0.1`），用 WebView 显示和网页版完全相同的界面。**数据只存在手机里**，不需要服务器和账号。地图底图、字体和地点搜索需要联网。

## 安装

1. 把 `dist/odyssey.apk` 传到手机上（微信文件传输助手、USB、网盘都可以）。
2. 在手机上点开 APK 安装。第一次安装需要允许「安装未知来源的应用」。
3. 更新时直接安装新的 APK，会覆盖旧版本，数据保留。

## 数据安全

- 数据在 App 的私有目录 `files/atlas-data/`，和桌面版的 `atlas-data/` 结构一样。
- **卸载 App 会删除所有数据。** 请定期在「管理地图集 → 导入 / 导出」导出 `.atlas` 文件，文件会保存到手机的 `下载/Odyssey/`。这个文件可以导入桌面版，也可以导入以后的网站版。
- 安卓自带的云备份只包含文字记录（地点、到访、心愿、个人资料），不包括照片，因为它每个 App 最多只能备份 25 MB。
- 签名密钥在开发机的 `~/.android/odyssey.jks`。**换了密钥打的包无法覆盖安装**，只能先卸载（数据会丢），所以请备份这个文件。

## App 补上的 WebView 缺失功能

| 网页里的操作 | App 里 |
|---|---|
| 上传照片、导入 `.atlas` | 打开系统的文件 / 相册选择器 |
| 导出、保存地图海报、保存票根图片 | 保存到 `下载/Odyssey/` |
| 分享票根 | 调起系统分享面板（微信、小红书等） |
| 返回键 | 依次关闭弹层、离开管理页、回到页面顶部，最后才退到后台；管理页里有没保存的表单时不会退出 |
| 外部链接 | 用手机浏览器打开 |

## 构建

需要 JDK 17 和 Android SDK（`platforms;android-34`、`build-tools;34.0.0`），默认使用仓库 `.tools/` 下的副本：

```bash
# 一次性安装工具（放在 .tools/，已被 gitignore）
curl -L -o /tmp/jdk17.tar.gz "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
mkdir -p .tools/jdk17 && tar -xzf /tmp/jdk17.tar.gz -C .tools/jdk17 --strip-components=1
curl -L -o /tmp/cmdline-tools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
mkdir -p .tools/android-sdk/cmdline-tools && unzip -q /tmp/cmdline-tools.zip -d .tools/android-sdk/cmdline-tools \
  && mv .tools/android-sdk/cmdline-tools/cmdline-tools .tools/android-sdk/cmdline-tools/latest
JAVA_HOME=$PWD/.tools/jdk17 .tools/android-sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=$PWD/.tools/android-sdk \
  "platforms;android-34" "build-tools;34.0.0"

apps/android/build.sh                 # 前端 + Go 服务 + APK → apps/android/dist/odyssey.apk
SKIP_FRONTEND=1 apps/android/build.sh # 复用已经嵌入的前端
```

不使用 Gradle：App 只有几个 Java 类和少量资源，直接用 SDK 里的 aapt2、javac、d8、zipalign、apksigner 打包。Go 服务以 `lib/<abi>/libodyssey.so` 的名字放进 APK，因为安卓只允许执行 App 原生库目录里的文件。arm64 用 `GOOS=android` 编译，32 位 ARM 用静态 linux 程序。安卓没有 `/etc/resolv.conf`，App 会把当前网络的 DNS 通过 `ATLAS_DNS` 传给 Go 服务，系统证书目录通过 `SSL_CERT_DIR` 传入。
