# A1 本机原生图标

仅用于当前 macOS 27 的个人本机修复，通过 package-mac.js --local-native-icon 启用。默认/官网构建保持原ICNS。

原图A1，仅在native mask内约24px外沿逆补偿系统27新增高光；球体及内侧背景不变。Assets.car为Xcode27 actool预编译资源，CFBundleIconName=QiuqiuA1，electron.icns仍保留。

ponytail: 当前系统校准；Apple原生渲染变化或公开多系统发布前须重验。编译器即使禁fallback仍含带补偿的旧位图，因此不能假定旧系统一定使用独立ICNS，不将本资源默认纳入公开包。

重编译：DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer /Applications/Xcode.app/Contents/Developer/usr/bin/actool QiuqiuA1.icon --compile OUTPUT --platform macosx --minimum-deployment-target 12.0 --target-device mac --app-icon QiuqiuA1 --enable-icon-stack-fallback-generation=disabled --output-partial-info-plist OUTPUT/partial-info.plist。仅复制Assets.car；不替换兼容ICNS。
