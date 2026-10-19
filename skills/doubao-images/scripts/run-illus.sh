#!/bin/bash
# 批量跑豆包插画：逐条读 prompts.txt（格式：场景ID|完整提示词——含风格前缀与无文字后缀），
# 失败重试一次，断点续跑，成功后自动裁豆包底部水印。
# 结尾按硬规则输出独特标记：BG_SUCCESS doubao-illus / BG_FAIL doubao-illus failed=<id列表>
#
# 2026-10-16 修订（BUMP 姊妹篇实测）：
#   1. 不再硬编码 STYLE_PREFIX 拼接——prompts.txt 每行即完整提示词（由阶段2产出），
#      旧版二次拼接会导致风格前缀重复；
#   2. doubao-one 下载 0 张（exit 3）视为失败并重试（旧版 exit 0 导致缺图假成功）；
#   3. 成功后按实际高度裁底部 5.5% 水印（crop=iw:trunc(ih*0.945):0:0）。
# 用法: bash run-illus.sh            （在包含 prompts.txt 的目录执行）
# 前置: Chrome 已由同任务内 `("chrome.exe" --remote-debugging-port=9222 ... &)` 拉起
#       （勿依赖 node detached spawn：沙箱后台任务里会 FAIL_LAUNCH）
set -u

# Windows Git Bash 需要补 PATH（coreutils）；Linux/macOS 可删掉这行
export PATH="/c/Program Files/Git/usr/bin:$PATH"
FF="$(command -v ffmpeg)"

echo $$ > ./run-illus.pid   # 自身 PID，供 watch-bg.mjs --pid-file 检测存活

FAILED=""
DONE=0
mkdir -p illus
while IFS='|' read -r sid prompt; do
  [ -z "$sid" ] && continue
  case "$sid" in \#*) continue;; esac
  if ls illus/${sid}_0.* >/dev/null 2>&1; then
    echo "SKIP $sid (exists)"
    continue
  fi
  echo "=== RUN $sid $(date +%H:%M:%S) ==="
  node doubao-one.mjs ./illus "$sid" "$prompt"
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "RETRY $sid (rc=$rc)"
    sleep 5
    node doubao-one.mjs ./illus "$sid" "$prompt"
    rc=$?
  fi
  # 产物校验：必须有 _0 文件且 >10KB（防 0 下载假成功/空文件）
  if [ $rc -eq 0 ] && ls illus/${sid}_0.* >/dev/null 2>&1 \
     && [ "$(stat -c%s illus/${sid}_0.* 2>/dev/null || echo 0)" -gt 10000 ]; then
    DONE=$((DONE + 1))
    # 裁豆包底部水印（按实际高度裁掉底部 5.5%）
    if [ -n "$FF" ]; then
      for f in illus/${sid}_*.jpg illus/${sid}_*.png; do
        [ -e "$f" ] || continue
        "$FF" -y -loglevel error -i "$f" -vf "crop=iw:trunc(ih*0.945):0:0" "${f%.*}_c.jpg"
        if [ -s "${f%.*}_c.jpg" ]; then mv "${f%.*}_c.jpg" "${f%.*}.jpg"; fi
      done
    fi
    echo "DONE_CROP $sid"
  else
    FAILED="$FAILED $sid"
    echo "GIVEUP $sid (rc=$rc)"
  fi
  echo "=== END $sid ==="
done < prompts.txt

if [ -z "$FAILED" ]; then
  echo "BG_SUCCESS doubao-illus generated=$DONE"
else
  echo "BG_FAIL doubao-illus generated=$DONE failed=$FAILED"
  exit 1
fi
