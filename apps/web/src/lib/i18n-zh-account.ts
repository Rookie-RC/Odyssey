// Chinese strings for accounts (cloud mode): the sign-in screen, the account
// card in Settings and the server's own error messages, which the sign-in
// screen shows verbatim (cloud/auth.go, cloud/users.go, cloud/password.go).
export const ZH_ACCOUNT: Record<string, string> = {
  // Sign-in screen
  "Every place you've been, and the ones still to come — on one map.": "去过的每一个地方，和还想去的下一站，都在一张地图上。",
  "Sign in": "登录",
  "Create account": "注册",
  "Sign in or create an account": "登录或注册",
  Email: "邮箱",
  Password: "密码",
  "At least 8 characters": "至少 8 个字符",
  "Show password": "显示密码",
  "Hide password": "隐藏密码",
  "Signing in…": "正在登录…",
  "Creating your atlas…": "正在创建你的地图集…",
  "New here? Create an account": "第一次来？注册一个账号",
  "Already have an account? Sign in": "已有账号？直接登录",
  "Your atlas is private: only you can see it once you sign in.": "你的地图集是私密的：登录后只有你自己能看到。",
  "Sign-up is closed on this server. Ask its owner for an account.": "这台服务器暂不开放注册，请联系管理员开通账号。",
  "Could not reach the server. Check your connection and try again.": "连接不到服务器，请检查网络后重试。",

  // Server messages (shown verbatim)
  "incorrect email or password": "邮箱或密码不正确",
  "incorrect password": "密码不正确",
  "an account with this email already exists": "这个邮箱已经注册过了",
  "enter a valid email address": "请输入有效的邮箱地址",
  "password must be at least 8 characters": "密码至少需要 8 个字符",
  "password must be at most 512 characters": "密码最多 512 个字符",
  "sign-up is closed on this server": "这台服务器暂不开放注册",
  "too many sign-in attempts; try again later": "尝试次数过多，请稍后再试",
  "too many sign-ups from this network; try again later": "这个网络注册过于频繁，请稍后再试",
  "too many attempts; try again later": "尝试次数过多，请稍后再试",
  "sign in required": "请先登录",

  // Account card (Manage Atlas → Settings)
  Account: "账号",
  "Signed in as": "当前登录账号",
  "Storage used": "已用空间",
  "{used} of {quota}": "{used} / {quota}",
  "{used} (no limit)": "{used}（不限）",
  "Sign out": "退出登录",
  "Sign out everywhere": "退出所有设备",
  "Ends the session on every phone and computer signed in to this account.": "让所有登录了这个账号的手机和电脑都退出登录。",
  "Change password": "修改密码",
  "Current password": "当前密码",
  "New password": "新密码",
  "Password changed. Other devices have been signed out.": "密码已修改，其他设备已退出登录。",
  "Delete account": "注销账号",
  "Deletes your account and your whole atlas — places, visits, wishes, photos and backups. This cannot be undone.":
    "删除账号以及整个地图集——地点、到访、心愿、照片和备份都会被删除，且无法恢复。",
  "Export your atlas first (Import / Export) if you might want it back.": "如果以后可能还想要这些内容，请先在「导入 / 导出」里导出地图集。",
  "Enter your password to confirm": "输入密码以确认",
  "Delete my account": "确认注销",
  "Deleting…": "正在删除…",
};
