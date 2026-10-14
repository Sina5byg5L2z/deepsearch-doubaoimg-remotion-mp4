#!/bin/bash
# 批量跑豆包插画：逐条读 prompts.txt（格式：场景ID|提示词），失败重试一次，断点续跑
# 结尾按硬规则输出独特标记：BG_SUCCESS doubao-illus / BG_FAIL doubao-illus failed=<id列表>
# 用法: bash run-illus.sh            （在包含 prompts.txt 的目录执行）
set -u

# Windows Git Bash 需要补 PATH（coreutils）；Linux/macOS 可删掉这行
export PATH="/c/Program Files/Git/usr/bin:$PATH"

STYLE_PREFIX="手绘科普插画，米白色纸张背景，黑色钢笔简笔画线条，局部淡彩（浅蓝浅黄浅粉），Q版漫画人物，构图简洁大量留白。"
STYLE_SUFFIX="画面中绝对不要出现任何文字、数字、字母。"

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
  node doubao-one.mjs ./illus "$sid" "${STYLE_PREFIX}${prompt}。${STYLE_SUFFIX}"
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "RETRY $sid (rc=$rc)"
    sleep 5
    node doubao-one.mjs ./illus "$sid" "${STYLE_PREFIX}${prompt}。${STYLE_SUFFIX}"
    rc=$?
  fi
  if [ $rc -eq 0 ]; then
    DONE=$((DONE + 1))
  else
    FAILED="$FAILED $sid"
    echo "GIVEUP $sid"
  fi
  echo "=== END $sid rc=$rc ==="
done < prompts.txt

if [ -z "$FAILED" ]; then
  echo "BG_SUCCESS doubao-illus generated=$DONE"
else
  echo "BG_FAIL doubao-illus generated=$DONE failed=$FAILED"
fi
