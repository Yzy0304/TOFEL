#!/bin/zsh
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  print "需要 Node.js 22 或更新版本。"
  read "?按回车关闭"
  exit 1
fi
exec node server.mjs
